# org/views.py - 组织架构 API
from rest_framework import viewsets, status, permissions
from rest_framework.decorators import action
from rest_framework.response import Response
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from accounts.models import Tenant, Department, TenantMembership, CustomUser
from .models import UserDepartment, ReportRelation, OrgChangeLog
from .serializers import (
    TenantSerializer, TenantCreateSerializer, TenantMembershipSerializer,
    DepartmentTreeSerializer, DepartmentCreateSerializer,
    UserDepartmentSerializer,
    ReportRelationSerializer, OrgChangeLogSerializer,
)
from .permissions import OrgPermission
from .filters import TenantFilterBackend
from accounts.middleware import set_current_tenant as _set_thread_tenant
from oa.views import send_work_notification
from loguru import logger

def _resolve_tenant(request):
    """尝试从用户成员关系解析 tenant（中间件未设置时的降级方案）"""
    tenant = getattr(request, 'tenant', None)
    if not tenant:
        user = getattr(request, 'user', None)
        if user and user.is_authenticated:
            active = user.get_active_tenant()
            if active:
                from accounts.middleware import set_current_tenant
                request.tenant = active
                set_current_tenant(active)
                tenant = active
    return tenant


def rebuild_report_relations(tenant):
    """
    根据企业组织架构自动重建汇报关系（钉钉模式）：
    1. 子部门负责人 → 父部门负责人（跨层级）
    2. 副负责人 → 主负责人
    3. 成员 → 副负责人（有则优先）→ 主负责人（副负责人不存在或同一个人时）
    4. 无负责人的部门 → 自动归属到最近的有负责人的上级部门
    5. 子部门全体成员 → 父部门负责人（间接，通过子部门负责人串联）
    """
    from .models import ReportRelation, UserDepartment

    # 清除该企业所有汇报关系
    ReportRelation.objects.filter(tenant=tenant).delete()

    # 获取该企业所有激活部门（按 level 升序，确保先处理上级部门）
    depts = Department.objects.filter(
        tenant=tenant, is_active=True
    ).order_by('level', 'sort_order')

    created = 0
    # 缓存每个部门的负责人（含向上回溯）
    dept_manager_cache = {}
    dept_deputy_cache = {}

    for dept in depts:
        # 确定该部门的有效负责人
        manager = dept.manager
        if not manager:
            # 向上回溯找到最近的有负责人的上级部门
            cur = dept.parent
            while cur and not manager:
                manager = cur.manager
                cur = cur.parent

        dept_manager_cache[dept.id] = manager
        # 获取副负责人列表
        deputy_ids = list(dept.deputy_managers.values_list('id', flat=True))
        dept_deputy_cache[dept.id] = deputy_ids

        if not manager:
            continue

        # 获取部门成员
        member_qs = UserDepartment.objects.filter(department=dept).select_related('user')
        member_ids = list(member_qs.values_list('user_id', flat=True))

        for uid in member_ids:
            if uid == manager.id:
                continue  # 负责人不向自己汇报

            # 判断汇报对象：副负责人优先，否则向主负责人
            is_deputy = uid in deputy_ids
            if is_deputy:
                # 副负责人 → 主负责人
                supervisor = manager
                is_direct = True
            else:
                # 普通成员 → 副负责人（有则优先），否则 → 主负责人
                if deputy_ids:
                    # 找第一个副负责人作为汇报对象
                    try:
                        first_deputy = CustomUser.objects.get(id=deputy_ids[0])
                        supervisor = first_deputy
                        is_direct = True
                    except CustomUser.DoesNotExist:
                        supervisor = manager
                        is_direct = True
                else:
                    supervisor = manager
                    is_direct = True

            if supervisor and supervisor.id != uid:
                _, cr = ReportRelation.objects.get_or_create(
                    tenant=tenant, user_id=uid, department=dept,
                    defaults={'supervisor': supervisor, 'is_direct': is_direct}
                )
                if cr:
                    created += 1

        # 上级部门负责人 → 本部门负责人（跨部门汇报）
        if dept.parent:
            parent_mgr = dept_manager_cache.get(dept.parent.id)
            if not parent_mgr and dept.parent:
                cur = dept.parent
                while cur and not parent_mgr:
                    parent_mgr = dept_manager_cache.get(cur.id) or cur.manager
                    cur = cur.parent

            if parent_mgr and parent_mgr.id != manager.id:
                _, cr = ReportRelation.objects.get_or_create(
                    tenant=tenant, user=manager, department=dept.parent,
                    defaults={'supervisor': parent_mgr, 'is_direct': False}
                )
                if cr:
                    created += 1

    return created


def _can_see_dept(dept, user, user_dept_ids=None):
    """判断用户是否有权查看该部门"""
    if not user:
        return True
    if user.is_superuser:
        return True
    role = None
    if hasattr(user, 'get_tenant_role'):
        role = user.get_tenant_role(dept.tenant) if dept.tenant_id else None
    if role in ('owner', 'admin'):
        return True
    if dept.visibility == 'public':
        return True
    if dept.visibility == 'hidden':
        return False
    if user_dept_ids is None:
        user_dept_ids = set(UserDepartment.objects.filter(
            user=user
        ).values_list('department_id', flat=True))
    if dept.id in user_dept_ids:
        return True
    if dept.visibility == 'department':
        for uid in user_dept_ids:
            try:
                d = Department.objects.get(id=uid)
                if dept.id in d.get_descendant_ids():
                    return True
            except Department.DoesNotExist:
                pass
        return False
    if dept.visibility == 'custom':
        return bool(user_dept_ids) and dept.visible_departments.filter(id__in=list(user_dept_ids)).exists()
    return True


def _build_tree(department, depth=0, max_depth=15, user=None, user_dept_ids=None):
    """递归构建部门树（支持可见性过滤）"""
    if depth > max_depth:
        return None
    if user and not _can_see_dept(department, user, user_dept_ids):
        return None
    mgr_info = None
    if department.manager:
        mgr_info = {
            'id': department.manager.id,
            'username': department.manager.username,
            'real_name': department.manager.real_name or '',
            'avatar': department.manager.get_avatar_url(),
            'position': department.manager.position or '',
        }
    data = {
        'id': department.id, 'name': department.name,
        'code': department.code,
        'manager': department.manager.real_name if department.manager else None,
        'manager_info': mgr_info,
        'visibility': department.visibility,
        'member_count': department.get_member_count(),
        'department_type': department.department_type,
        'children': [],
    }
    for child in Department.objects.filter(
        parent=department, is_active=True
    ).order_by('sort_order'):
        child_data = _build_tree(child, depth + 1, max_depth, user, user_dept_ids)
        if child_data:
            data['children'].append(child_data)
    return data


class TenantViewSet(viewsets.ModelViewSet):
    serializer_class = TenantSerializer
    permission_classes = [permissions.IsAuthenticated, OrgPermission]

    def get_queryset(self):
        user = self.request.user
        if user.is_superuser:
            return Tenant.objects.all().distinct()
        return Tenant.objects.filter(
            memberships__user=user,
            memberships__is_active=True
        ).distinct()

    def get_serializer_class(self):
        if self.action == 'create':
            return TenantCreateSerializer
        return TenantSerializer

    @transaction.atomic
    def perform_create(self, serializer):
        if not self.request.user.is_superuser:
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied('只有超级管理员才能创建企业')
        tenant = serializer.save(owner=self.request.user)
        TenantMembership.objects.create(
            user=self.request.user, tenant=tenant, role='owner',
            is_active=True, is_default=True,
        )
        self.request.user.active_tenant = tenant
        self.request.user.save(update_fields=['active_tenant'])
        # 立即更新当前请求的 tenant 上下文
        self.request.tenant = tenant
        _set_thread_tenant(tenant)

    @action(detail=True, methods=['post'])
    def switch(self, request, pk=None):
        tenant = self.get_object()
        try:
            request.user.switch_tenant(tenant.id)
            # 立即更新当前请求的 tenant 上下文
            request.tenant = tenant
            _set_thread_tenant(tenant)
            OrgChangeLog.objects.create(
                tenant=tenant, action='switch_tenant', operator=request.user,
                detail={'user': request.user.username}
            )
            return Response({'success': True, 'message': '已切换到 ' + tenant.name,
                            'tenant': TenantSerializer(tenant, context={'request': request}).data})
        except PermissionError as e:
            return Response({'error': str(e)}, status=status.HTTP_403_FORBIDDEN)

    @action(detail=True, methods=['get'])
    def members(self, request, pk=None):
        tenant = self.get_object()
        page = int(request.query_params.get('page', 1))
        page_size = int(request.query_params.get('page_size', 20))
        search = request.query_params.get('q', '').strip()
        memberships = TenantMembership.objects.filter(
            tenant=tenant, is_active=True).select_related('user')
        if search:
            memberships = memberships.filter(
                Q(user__username__icontains=search) |
                Q(user__real_name__icontains=search) |
                Q(user__email__icontains=search)
            )
        total = memberships.count()
        start = (page - 1) * page_size
        results = []
        for m in memberships[start:start + page_size]:
            u = m.user
            # 获取用户组织架构部门
            from org.models import UserDepartment
            from accounts.models import TenantMembership as TM
            user_depts = UserDepartment.objects.filter(user=u).select_related('department')
            org_depts = [{
                'id': ud.department_id,
                'name': ud.department.name,
                'is_primary': ud.is_primary,
                'position': ud.position or '',
            } for ud in user_depts]
            # 获取用户所属的所有企业
            user_tenants = list(TM.objects.filter(user=u, is_active=True).select_related('tenant').values(
                'tenant_id', 'role', 'tenant__name', 'tenant__short_name'
            ))
            tenants_list = [{
                'id': t['tenant_id'],
                'name': t['tenant__name'],
                'short_name': t['tenant__short_name'],
                'role': t['role'],
            } for t in user_tenants]
            results.append({
                'id': u.id, 'username': u.username,
                'real_name': u.real_name or '', 'avatar': u.get_avatar_url(),
                'email': u.email, 'phone': u.phone or '',
                'position': u.position or '',
                'role': m.role, 'role_display': m.get_role_display(),
                'employee_id': m.employee_id or '', 'is_active': u.is_active,
                'joined_at': m.joined_at,
                'active_tenant_id': u.active_tenant_id,
                'org_departments': org_depts,
                'tenants': tenants_list,
            })
        return Response({
            'results': results, 'count': total,
            'page': page, 'page_size': page_size
        })

    @action(detail=True, methods=['post'])
    def invite(self, request, pk=None):
        tenant = self.get_object()
        user_id = request.data.get('user_id')
        role = request.data.get('role', 'member')
        if not user_id:
            return Response({'error': '缺少用户ID'}, status=400)
        try:
            user = CustomUser.objects.get(id=user_id)
            user.active_tenant = tenant
            user.save(update_fields=['active_tenant'])
        except CustomUser.DoesNotExist:
            return Response({'error': '用户不存在'}, status=404)
        membership, created = TenantMembership.objects.get_or_create(
            user=user, tenant=tenant,
            defaults={'role': role, 'is_active': True}
        )
        if not created:
            if membership.is_active:
                return Response({'error': '该用户已是企业成员'}, status=400)
            membership.is_active = True
            membership.role = role
            membership.save()
        OrgChangeLog.objects.create(
            tenant=tenant, action='add_member', operator=request.user,
            detail={'user_id': user_id, 'username': user.username}
        )
        # 发送工作通知
        operator_name = request.user.real_name or request.user.username
        send_work_notification(
            user_id=user.id, title='加入企业通知',
            content=f'您已被 {operator_name} 邀请加入企业「{tenant.name}」',
            notification_type='hr',
            related_url='/org/',
            extra_data={'tenant_id': tenant.id, 'tenant_name': tenant.name},
        )
        return Response({'message': '添加成功'})

    @action(detail=True, methods=['post'])
    def remove_member(self, request, pk=None):
        tenant = self.get_object()
        user_id = request.data.get('user_id')
        if not user_id:
            return Response({'error': '缺少用户ID'}, status=400)
        try:
            membership = TenantMembership.objects.get(
                user_id=user_id, tenant=tenant, is_active=True)
        except TenantMembership.DoesNotExist:
            return Response({'error': '该用户不是企业成员'}, status=404)
        if membership.role == 'owner':
            return Response({'error': '无法移除企业所有者'}, status=400)
        membership.is_active = False
        membership.left_at = timezone.now()
        membership.save(update_fields=['is_active', 'left_at'])
        operator_name = request.user.real_name or request.user.username
        send_work_notification(
            user_id=user_id, title='移出企业通知',
            content=f'您已被 {operator_name} 移出企业「{tenant.name}」',
            notification_type='hr',
            extra_data={'tenant_id': tenant.id, 'tenant_name': tenant.name},
        )
        return Response({'message': '已移除'})

    @action(detail=True, methods=['post'])
    def update_member(self, request, pk=None):
        """更新企业成员的信息（职位、角色、主部门、默认企业）"""
        tenant = self.get_object()
        user_id = request.data.get('user_id')
        position = request.data.get('position')
        role = request.data.get('role')
        primary_department_id = request.data.get('primary_department_id')
        default_tenant_id = request.data.get('default_tenant_id')
        if not user_id:
            return Response({'error': '缺少用户ID'}, status=400)
        try:
            membership = TenantMembership.objects.get(
                user_id=user_id, tenant=tenant, is_active=True)
        except TenantMembership.DoesNotExist:
            return Response({'error': '该用户不是企业成员'}, status=404)
        # 更新角色
        if role and role in dict(TenantMembership.ROLE_CHOICES):
            if membership.role == 'owner' and role != 'owner':
                return Response({'error': '无法更改企业所有者的角色'}, status=400)
            membership.role = role
            membership.save(update_fields=['role'])
        # 更新部门职位（所有部门统一更新）
        if position is not None:
            UserDepartment.objects.filter(user_id=user_id).update(position=position)
        # 设置主部门
        if primary_department_id is not None:
            if primary_department_id:
                from accounts.models import Department as DeptModel
                try:
                    dept = DeptModel.objects.get(id=primary_department_id, tenant=tenant, is_active=True)
                    UserDepartment.objects.filter(user_id=user_id, is_primary=True).update(is_primary=False)
                    UserDepartment.objects.filter(user_id=user_id, department_id=dept.id).update(is_primary=True)
                except DeptModel.DoesNotExist:
                    pass
            else:
                UserDepartment.objects.filter(user_id=user_id, is_primary=True).update(is_primary=False)
        # 设置默认企业（用户下次登录时的默认企业）
        if default_tenant_id is not None:
            from accounts.models import CustomUser
            try:
                target_user = CustomUser.objects.get(id=user_id)
                # 验证用户属于该企业
                if TenantMembership.objects.filter(user_id=user_id, tenant_id=default_tenant_id, is_active=True).exists():
                    target_user.active_tenant_id = default_tenant_id
                    target_user.save(update_fields=['active_tenant'])
            except CustomUser.DoesNotExist:
                pass
        return Response({'message': '成员信息已更新'})

    @action(detail=True, methods=['put'])
    def member_role(self, request, pk=None):
        tenant = self.get_object()
        user_id = request.data.get('user_id')
        role = request.data.get('role')
        if not user_id or not role:
            return Response({'error': '缺少参数'}, status=400)
        try:
            membership = TenantMembership.objects.get(
                user_id=user_id, tenant=tenant, is_active=True)
        except TenantMembership.DoesNotExist:
            return Response({'error': '用户不是企业成员'}, status=404)
        if membership.role == 'owner' and role != 'owner':
            return Response({'error': '无法更改企业所有者的角色'}, status=400)
        membership.role = role
        membership.save()
        role_map = {'owner': '企业所有者', 'admin': '管理员', 'dept_admin': '部门管理员', 'member': '普通成员'}
        operator_name = request.user.real_name or request.user.username
        send_work_notification(
            user_id=user_id, title='企业角色变更通知',
            content=f'您的企业角色已被 {operator_name} 变更为「{role_map.get(role, role)}」',
            notification_type='hr',
            extra_data={'tenant_id': tenant.id, 'role': role},
        )
        return Response({'message': '角色已更新'})

    @action(detail=True, methods=['get'])
    def stats(self, request, pk=None):
        tenant = self.get_object()
        return Response({
            'department_count': Department.objects.filter(
                tenant=tenant, is_active=True).count(),
            'member_count': TenantMembership.objects.filter(
                tenant=tenant, is_active=True).count(),
        })

    @action(detail=False, methods=['get'])
    def search_users(self, request):
        q = request.query_params.get('q', '').strip()
        if not q:
            return Response({'results': []})
        existing = TenantMembership.objects.filter(
            tenant=request.tenant, is_active=True
        ).values_list('user_id', flat=True)
        users = CustomUser.objects.filter(
            Q(username__icontains=q) | Q(real_name__icontains=q) | Q(email__icontains=q)
        ).exclude(id__in=existing)[:20]
        return Response({'results': [{
            'id': u.id, 'username': u.username,
            'real_name': u.real_name or '',
            'avatar': u.get_avatar_url(), 'email': u.email,
        } for u in users]})

    @action(detail=False, methods=['get'])
    def search_tenant_members(self, request):
        """搜索当前企业内的成员（用于选择负责人等）"""
        q = request.query_params.get('q', '').strip()
        tenant = request.tenant
        if not tenant:
            return Response({'results': []})
        members = TenantMembership.objects.filter(
            tenant=tenant, is_active=True
        ).select_related('user')
        if q:
            members = members.filter(
                Q(user__username__icontains=q) |
                Q(user__real_name__icontains=q) |
                Q(user__email__icontains=q)
            )
        results = []
        for m in members[:20]:
            u = m.user
            results.append({
                'id': u.id, 'username': u.username,
                'real_name': u.real_name or '',
                'avatar': u.get_avatar_url(),
                'email': u.email, 'position': u.position or '',
                'role': m.role,
                'in_tenant': True,
            })
        return Response({'results': results})

    @action(detail=False, methods=['get'])
    def search_all_users(self, request):
        """搜索所有系统用户（包括不在当前企业的），用于邀请和分配部门"""
        q = request.query_params.get('q', '').strip()
        tenant = request.tenant
        if not tenant:
            return Response({'results': []})
        # 已加入当前企业的用户 ID
        member_ids = set(TenantMembership.objects.filter(
            tenant=tenant, is_active=True
        ).values_list('user_id', flat=True))
        users = CustomUser.objects.all()
        if q:
            users = users.filter(
                Q(username__icontains=q) |
                Q(real_name__icontains=q) |
                Q(email__icontains=q)
            )
        results = []
        for u in users[:1000]:
            results.append({
                'id': u.id, 'username': u.username,
                'real_name': u.real_name or '',
                'avatar': u.get_avatar_url(),
                'email': u.email, 'position': u.position or '',
                'in_tenant': u.id in member_ids,
            })
        return Response({'results': results})


class DepartmentViewSet(viewsets.ModelViewSet):
    permission_classes = [permissions.IsAuthenticated, OrgPermission]
    filter_backends = [TenantFilterBackend]

    def get_serializer_class(self):
        if self.action in ('create', 'update', 'partial_update'):
            return DepartmentCreateSerializer
        return DepartmentTreeSerializer

    def get_queryset(self):
        # 支持 tenant_id 查询参数（管理员跨企业查询用）
        tenant_id = self.request.query_params.get('tenant_id')
        include_sub = self.request.query_params.get('include_subtenants', '').lower() in ('1', 'true')
        if tenant_id:
            qs = Department.objects.filter(
                tenant_id=tenant_id, is_active=True
            ).select_related('parent', 'manager')
            if include_sub:
                # 集团模式：同时包含子企业部门
                try:
                    from accounts.models import Tenant
                    t = Tenant.objects.get(id=tenant_id)
                    sub_ids = list(t.sub_tenants.filter(is_active=True).values_list('id', flat=True))
                    if sub_ids:
                        qs = Department.objects.filter(
                            tenant_id__in=[tenant_id] + sub_ids, is_active=True
                        ).select_related('parent', 'manager')
                except Exception:
                    pass
            return qs
        tenant = _resolve_tenant(self.request)
        if not tenant:
            return Department.objects.none()
        qs = Department.objects.filter(
            tenant=tenant, is_active=True
        ).select_related('parent', 'manager')

        # 集团模式：管理员可查看子企业部门
        if self.request.user.user_type in ('super_admin', 'admin'):
            try:
                sub_ids = list(tenant.sub_tenants.filter(is_active=True).values_list('id', flat=True))
                if sub_ids:
                    qs = Department.objects.filter(
                        tenant_id__in=[tenant.id] + sub_ids, is_active=True
                    ).select_related('parent', 'manager')
            except Exception:
                pass

        # 按可见性过滤
        return self._filter_by_visibility(qs, tenant)

    def _filter_by_visibility(self, qs, tenant):
        """根据用户角色和部门可见性过滤部门"""
        user = self.request.user
        # 超管和企业所有者/管理员可以看到全部
        if user.is_superuser:
            return qs
        role = None
        if hasattr(user, 'get_tenant_role'):
            role = user.get_tenant_role(tenant)
        if role in ('owner', 'admin'):
            return qs

        # 获取用户所在的部门 ID 集合
        user_dept_ids = set(UserDepartment.objects.filter(
            user=user
        ).values_list('department_id', flat=True))

        # 获取用户有权限的子部门 ID（所在部门的下级部门对成员也是可见的）
        visible_ids = set()
        for did in list(user_dept_ids):
            visible_ids.add(did)
            try:
                dept = Department.objects.get(id=did)
                visible_ids.update(dept.get_descendant_ids())
            except Department.DoesNotExist:
                pass

        # public: 所有人可见
        # department: 本部门及子部门成员可见
        # custom: 通过 visible_departments 控制
        # hidden: 仅管理员可见

        from django.db.models import Q
        public_q = Q(visibility='public')

        # department 可见性：用户所在部门及子部门
        dept_vis_q = Q(visibility='department', id__in=visible_ids) if visible_ids else Q()

        # custom 可见性：用户在 visible_departments 中
        custom_vis_q = Q(visibility='custom', visible_departments__in=list(user_dept_ids)) if user_dept_ids else Q()

        return qs.filter(public_q | dept_vis_q | custom_vis_q)

    def perform_create(self, serializer):
        tenant = self.request.tenant
        # 检查是否有同级同名的软删除部门，有则重新启用
        parent = serializer.validated_data.get('parent')
        parent_id = parent.id if parent else None
        name = serializer.validated_data.get('name', '')
        department = None
        if name and tenant:
            inactive = Department.objects.filter(
                tenant=tenant, name=name, parent_id=parent_id, is_active=False
            ).first()
            if inactive:
                inactive.is_active = True
                for field in ('code', 'description', 'department_type', 'sort_order',
                              'visibility', 'auto_create_group', 'auto_sync_members', 'tags'):
                    if field in serializer.validated_data:
                        setattr(inactive, field, serializer.validated_data[field])
                if 'manager' in serializer.validated_data:
                    inactive.manager = serializer.validated_data['manager']
                inactive.save()
                department = inactive
        if not department:
            department = serializer.save(tenant=tenant)

        # 部门群处理：重新激活已删除群，或者根据需要新建
        if department.department_group:
            from chat.models import ChatRoom
            ChatRoom.objects.filter(id=department.department_group_id, is_deleted=True).update(
                is_deleted=False, deleted_at=None, name=department.name)
        elif department.auto_create_group:
            from chat.models import ChatRoom
            group = ChatRoom.objects.create(
                name=department.name, room_type='group',
                tenant=tenant, creator=self.request.user,
            )
            department.department_group = group
            department.save(update_fields=['department_group'])

        OrgChangeLog.objects.create(
            tenant=tenant, action='create_dept',
            department=department, operator=self.request.user,
            detail={'name': department.name})
        if tenant:
            self._rebuild_report_relations(tenant)

    def perform_update(self, serializer):
        old = self.get_object()
        department = serializer.save()

        # 部门名称变更 → 同步更新部门群名称
        if department.name != old.name and department.department_group:
            department.department_group.name = department.name
            department.department_group.save(update_fields=['name'])

        # 部门负责人变更 → 同步群主（无负责人则设置操作人为群主）
        if department.department_group:
            new_owner = department.manager or self.request.user
            if department.department_group.creator_id != new_owner.id:
                department.department_group.creator = new_owner
                department.department_group.save(update_fields=['creator'])

        OrgChangeLog.objects.create(
            tenant=self.request.tenant, action='update_dept',
            department=department, operator=self.request.user,
            detail={'name': department.name, 'old_name': old.name})
        self._rebuild_report_relations(self.request.tenant)

    def perform_destroy(self, instance):
        # 检查是否有子部门
        has_children = Department.objects.filter(parent=instance, is_active=True).exists()
        if has_children:
            from rest_framework.exceptions import ValidationError
            raise ValidationError({'error': '该部门下还有子部门，不能删除，请先删除子部门'})

        OrgChangeLog.objects.create(
            tenant=self.request.tenant, action='delete_dept',
            department=instance, operator=self.request.user,
            detail={'name': instance.name})
        # 软删除部门
        now = timezone.now()
        instance.is_active = False
        instance.save(update_fields=['is_active'])
        # 软删除对应的部门群
        if instance.department_group:
            instance.department_group.is_deleted = True
            instance.department_group.deleted_at = now
            instance.department_group.save(update_fields=['is_deleted', 'deleted_at'])
        self._rebuild_report_relations(self.request.tenant)

    def _rebuild_report_relations(self, tenant):
        """自动重建汇报关系"""
        if tenant:
            rebuild_report_relations(tenant)

    @action(detail=True, methods=['post'])
    def move(self, request, pk=None):
        department = self.get_object()
        parent_id = request.data.get('parent_id')
        if parent_id:
            try:
                parent = Department.objects.get(id=parent_id, tenant=request.tenant)
                if parent.id == department.id or department.id in parent.get_ancestor_ids():
                    return Response({'error': '不能移动到自身或子部门'}, status=400)
                department.parent = parent
            except Department.DoesNotExist:
                return Response({'error': '目标部门不存在'}, status=404)
        else:
            department.parent = None
        department.save()
        OrgChangeLog.objects.create(
            tenant=request.tenant, action='move_dept',
            department=department, operator=request.user,
            detail={'parent_id': parent_id})
        return Response(DepartmentTreeSerializer(department).data)

    @action(detail=True, methods=['post'])
    def sort(self, request, pk=None):
        department = self.get_object()
        department.sort_order = request.data.get('sort_order', 0)
        department.save(update_fields=['sort_order'])
        return Response({'message': 'ok'})

    @action(detail=True, methods=['post'])
    def enable(self, request, pk=None):
        """启用部门及对应的部门群，递归启用子部门"""
        department = self.get_object()
        now = timezone.now()

        def _enable(dept):
            dept.is_active = True
            dept.save(update_fields=['is_active'])
            if dept.department_group:
                dept.department_group.is_deleted = False
                dept.department_group.deleted_at = None
                dept.department_group.save(update_fields=['is_deleted', 'deleted_at'])
            children = Department.objects.filter(parent=dept, is_active=False)
            for child in children:
                _enable(child)

        _enable(department)
        self._rebuild_report_relations(request.tenant)
        OrgChangeLog.objects.create(
            tenant=request.tenant, action='update_dept',
            department=department, operator=request.user,
            detail={'name': department.name, 'action': 'enable'})
        return Response({'message': f'部门「{department.name}」已启用'})

    @action(detail=True, methods=['post'])
    def set_leaders(self, request, pk=None):
        department = self.get_object()
        self.check_object_permissions(request, department)
        manager_id = request.data.get('manager_id')
        deputy_ids = request.data.get('deputy_ids', [])

        # 校验：主负责人和副负责人不能是同一个
        if manager_id and manager_id in deputy_ids:
            return Response({'error': '主负责人和副负责人不能是同一个人'}, status=400)

        # 记录变更前的值
        old_manager_id = department.manager_id
        old_deputy_ids = set(department.deputy_managers.values_list('id', flat=True))

        # 自动将当前企业外的用户加入企业
        all_leader_ids = []
        if manager_id:
            all_leader_ids.append(manager_id)
        all_leader_ids.extend(deputy_ids)
        self._ensure_enterprise_members(request.tenant, all_leader_ids)

        if manager_id:
            try:
                department.manager = CustomUser.objects.get(id=manager_id)
            except CustomUser.DoesNotExist:
                return Response({'error': '用户不存在'}, status=404)
        else:
            department.manager = None
        department.save(update_fields=['manager'])
        # 设置/修改主负责人 → 同步为该部门群的群主
        if department.department_group:
            new_owner = department.manager or request.user
            if department.department_group.creator_id != new_owner.id:
                department.department_group.creator = new_owner
                department.department_group.save(update_fields=['creator'])
        if deputy_ids:
            department.deputy_managers.set(deputy_ids)
        else:
            # 显式清空副负责人
            department.deputy_managers.clear()

        # 确定发生变更的负责人，仅发送通知给实际变更者
        new_deputy_ids = set(department.deputy_managers.values_list('id', flat=True))
        changed_manager = old_manager_id != department.manager_id
        removed_deputies = old_deputy_ids - new_deputy_ids
        added_deputies = new_deputy_ids - old_deputy_ids

        self._send_leader_notifications(
            request, department,
            manager_id if changed_manager else None,
            list(added_deputies), list(removed_deputies),
        )

        OrgChangeLog.objects.create(
            tenant=request.tenant, action='set_leader',
            department=department, operator=request.user,
            detail={'manager_id': manager_id, 'deputy_ids': deputy_ids})
        self._rebuild_report_relations(request.tenant)
        return self._leaders_response(department)

    def _ensure_enterprise_members(self, tenant, user_ids):
        """确保目标用户都是当前企业成员，非成员自动加入"""
        if not tenant or not user_ids:
            return
        existing = set(TenantMembership.objects.filter(
            tenant=tenant, user_id__in=user_ids, is_active=True
        ).values_list('user_id', flat=True))
        for uid in user_ids:
            if uid not in existing:
                TenantMembership.objects.get_or_create(
                    user_id=uid, tenant=tenant,
                    defaults={'role': 'member', 'is_active': True}
                )

    @action(detail=True, methods=['post'])
    def set_deputies(self, request, pk=None):
        """单独设置副负责人"""
        department = self.get_object()
        self.check_object_permissions(request, department)
        deputy_ids = request.data.get('deputy_ids', [])

        # 记录变更前的副负责人
        old_deputy_ids = set(department.deputy_managers.values_list('id', flat=True))

        self._ensure_enterprise_members(request.tenant, deputy_ids)
        department.deputy_managers.set(deputy_ids)

        new_deputy_ids = set(department.deputy_managers.values_list('id', flat=True))
        added_deputies = new_deputy_ids - old_deputy_ids
        removed_deputies = old_deputy_ids - new_deputy_ids

        OrgChangeLog.objects.create(
            tenant=request.tenant, action='set_leader',
            department=department, operator=request.user,
            detail={'deputy_ids': deputy_ids})
        self._rebuild_report_relations(request.tenant)
        self._send_leader_notifications(request, department, None, list(added_deputies), list(removed_deputies))
        return self._leaders_response(department)

    def _send_leader_notifications(self, request, department, manager_id, added_deputies, removed_deputies=None):
        operator_name = request.user.real_name or request.user.username
        group_name = department.department_group.name if department.department_group else '无'
        group_owner = ''
        if department.department_group and department.department_group.creator:
            group_owner = department.department_group.creator.real_name or department.department_group.creator.username
        mgr_name = ''
        if department.manager:
            mgr_name = department.manager.real_name or department.manager.username
        base_info = f'部门「{department.name}」负责人「{mgr_name}」部门群「{group_name}」群主「{group_owner}」'
        if manager_id:
            send_work_notification(
                user_id=manager_id, title='部门负责人通知',
                content=f'您已被 {operator_name} 设置为{base_info}',
                notification_type='hr', related_url='/org/',
                extra_data={'department_id': department.id, 'department_name': department.name, 'role': 'manager'},
            )
        # 通知新加入的副负责人
        for did in (added_deputies or []):
            send_work_notification(
                user_id=did, title='部门副负责人通知',
                content=f'您已被 {operator_name} 设置为部门「{department.name}」副负责人',
                notification_type='hr', related_url='/org/',
                extra_data={'department_id': department.id, 'department_name': department.name, 'role': 'deputy'},
            )
        # 通知被移除的副负责人
        for did in (removed_deputies or []):
            send_work_notification(
                user_id=did, title='移除副负责人通知',
                content=f'您已被 {operator_name} 移除部门「{department.name}」副负责人职务',
                notification_type='hr', related_url='/org/',
                extra_data={'department_id': department.id, 'department_name': department.name, 'role': 'deputy_removed'},
            )

    def _leaders_response(self, department):
        # 返回完整负责人信息
        manager_data = None
        if department.manager:
            manager_data = {
                'id': department.manager.id,
                'username': department.manager.username,
                'real_name': department.manager.real_name or '',
                'avatar': department.manager.get_avatar_url(),
            }
        deputies_data = []
        for du in department.deputy_managers.all():
            deputies_data.append({
                'id': du.id, 'username': du.username,
                'real_name': du.real_name or '',
                'avatar': du.get_avatar_url(),
            })
        return Response({
            'manager': manager_data,
            'deputy_managers': deputies_data,
            'department_id': department.id,
            'department_name': department.name,
        })

    @action(detail=True, methods=['get'])
    def members(self, request, pk=None):
        department = self.get_object()
        page = int(request.query_params.get('page', 1))
        page_size = int(request.query_params.get('page_size', 20))
        relations = UserDepartment.objects.filter(
            department=department).select_related('user')
        total = relations.count()
        start = (page - 1) * page_size
        mgr_id = department.manager_id
        deputy_ids = set(department.deputy_managers.values_list('id', flat=True))
        # 批量获取企业角色
        user_ids = [r.user_id for r in relations]
        membership_map = {}
        if user_ids and request.tenant:
            for m in TenantMembership.objects.filter(tenant=request.tenant, user_id__in=user_ids, is_active=True):
                membership_map[m.user_id] = m.role
        results = []
        for r in relations[start:start + page_size]:
            uid = r.user.id
            results.append({
                'id': uid, 'username': r.user.username,
                'real_name': r.user.real_name or '',
                'avatar': r.user.get_avatar_url(),
                'position': r.position or r.user.position or '',
                'is_primary': r.is_primary, 'join_date': r.join_date,
                'email': r.user.email, 'phone': r.user.phone or '',
                'is_manager': uid == mgr_id,
                'is_deputy': uid in deputy_ids,
                'enterprise_role': membership_map.get(uid, 'member'),
            })
        # 排序：主负责人 > 副负责人 > 普通成员
        results.sort(key=lambda x: (0 if x['is_manager'] else (1 if x['is_deputy'] else 2), x['real_name'] or x['username']))
        return Response({
            'results': results, 'count': total,
            'page': page, 'page_size': page_size
        })

    @action(detail=True, methods=['post'])
    def add_members(self, request, pk=None):
        department = self.get_object()
        user_ids = request.data.get('user_ids', [])
        if not user_ids:
            return Response({'error': '请选择成员'}, status=400)
        tenant = request.tenant
        logger.info(f'tenant: {tenant}, user_ids: {user_ids}')
        # 自动邀请不在当前企业中的用户加入企业
        existing_members = TenantMembership.objects.filter(
            tenant=tenant, user_id__in=user_ids, is_active=True
        ).values_list('user_id', flat=True)
        newly_invited = []
        for uid in user_ids:
            if uid not in existing_members:
                membership, created = TenantMembership.objects.get_or_create(
                    user_id=uid, tenant=tenant,
                    defaults={'role': 'member', 'is_active': True}
                )
                if not created:
                    if membership.is_active:
                        logger.info(f'用户 {uid} 已是企业成员')
                    membership.is_active = True
                    membership.save()

                newly_invited.append(uid)
        added = 0
        added_ids = []
        for uid in user_ids:
            _, created = UserDepartment.objects.get_or_create(
                user_id=uid, department=department,
                defaults={
                    'is_primary': not UserDepartment.objects.filter(user_id=uid).exists()
                }
            )
            if created:
                added += 1
                added_ids.append(uid)
        if department.auto_sync_members and department.department_group:
            users = CustomUser.objects.filter(id__in=user_ids)
            department.department_group.members.add(*list(users))
        detail = {'user_ids': user_ids, 'count': added}
        if newly_invited:
            detail['auto_invited'] = newly_invited
        OrgChangeLog.objects.create(
            tenant=tenant, action='add_member',
            department=department, operator=request.user,
            detail=detail)
        # 重建汇报关系
        self._rebuild_report_relations(tenant)
        # 发送工作通知给新添加的成员
        operator_name = request.user.real_name or request.user.username
        for uid in added_ids:
            send_work_notification(
                user_id=uid, title='加入部门通知',
                content=f'您已被 {operator_name} 添加到部门「{department.name}」',
                notification_type='hr',
                related_url='/org/',
                extra_data={'department_id': department.id, 'department_name': department.name},
            )
        msg = '成功添加 %d 名成员到「%s」' % (added, department.name)
        if newly_invited:
            msg += '，其中 %d 名用户已自动加入企业' % len(newly_invited)
        return Response({'message': msg, 'added': added, 'auto_invited': len(newly_invited)})

    @action(detail=True, methods=['post'])
    def remove_members(self, request, pk=None):
        department = self.get_object()
        user_ids = request.data.get('user_ids', [])
        if not user_ids:
            return Response({'error': '请选择成员'}, status=400)
        UserDepartment.objects.filter(
            department=department, user_id__in=user_ids).delete()
        if department.auto_sync_members and department.department_group:
            department.department_group.members.remove(*user_ids)
        OrgChangeLog.objects.create(
            tenant=request.tenant, action='remove_member',
            department=department, operator=request.user,
            detail={'user_ids': user_ids})
        self._rebuild_report_relations(request.tenant)
        operator_name = request.user.real_name or request.user.username
        for uid in user_ids:
            send_work_notification(
                user_id=uid, title='移出部门通知',
                content=f'您已被 {operator_name} 移出部门「{department.name}」',
                notification_type='hr',
                extra_data={'department_id': department.id, 'department_name': department.name},
            )
        return Response({'message': '已移除'})

    @action(detail=True, methods=['post'])
    def update_member_position(self, request, pk=None):
        """更新部门成员职位"""
        department = self.get_object()
        user_id = request.data.get('user_id')
        position = request.data.get('position', '')
        if not user_id:
            return Response({'error': '缺少用户ID'}, status=400)
        try:
            rel = UserDepartment.objects.get(department=department, user_id=user_id)
            rel.position = position
            rel.save(update_fields=['position'])
            return Response({'message': '职位已更新', 'position': position})
        except UserDepartment.DoesNotExist:
            return Response({'error': '该用户不在此部门'}, status=404)

    @action(detail=False, methods=['get'])
    def search(self, request):
        q = request.query_params.get('q', '').strip()
        if not q:
            return Response({'results': []})
        depts = Department.objects.filter(
            tenant=request.tenant, is_active=True,
            name__icontains=q)[:20]
        results = []
        for d in depts:
            # Build ancestor ID chain from root to parent
            parent_ids = []
            cur = d.parent
            while cur:
                parent_ids.insert(0, cur.id)
                cur = cur.parent
            results.append({
                'id': d.id,
                'name': d.full_path or d.name,
                'parent_id': d.parent_id,
                'parent_ids': parent_ids,
            })
        return Response({'results': results})

    @action(detail=True, methods=['get'])
    def path(self, request, pk=None):
        department = self.get_object()
        path = []
        cur = department
        while cur:
            path.insert(0, {'id': cur.id, 'name': cur.name})
            cur = cur.parent
        return Response(path)

    @action(detail=True, methods=['get'])
    def org_chart(self, request, pk=None):
        department = self.get_object()
        data = self._build_org_chart(department)
        return Response(data)

    def _build_org_chart(self, department, max_depth=10):
        data = {
            'id': department.id, 'name': department.name,
            'code': department.code,
            'manager': department.manager.real_name if department.manager else None,
            'member_count': department.get_member_count(),
            'children': [],
        }
        if max_depth > 0:
            children = Department.objects.filter(
                parent=department, is_active=True
            ).order_by('sort_order')
            for child in children:
                data['children'].append(
                    self._build_org_chart(child, max_depth - 1))
        return data

    @action(detail=True, methods=['get'])
    def leaders(self, request, pk=None):
        """获取部门负责人和副负责人列表"""
        department = self.get_object()
        manager_data = None
        if department.manager:
            manager_data = {
                'id': department.manager.id, 'username': department.manager.username,
                'real_name': department.manager.real_name or '', 'position': department.manager.position or '',
                'avatar': department.manager.get_avatar_url(),
            }
        deputies_data = []
        for du in department.deputy_managers.all():
            deputies_data.append({
                'id': du.id, 'username': du.username,
                'real_name': du.real_name or '', 'position': du.position or '',
                'avatar': du.get_avatar_url(),
            })
        return Response({
            'manager': manager_data,
            'deputy_managers': deputies_data,
            'department_id': department.id,
            'department_name': department.name,
        })

    @action(detail=False, methods=['post'])
    def create_sub_tenant(self, request):
        """集团创建子公司（原子化：创建企业+部门+部门群）"""
        import uuid
        from accounts.models import Tenant, CustomUser
        from .models import UserDepartment
        from chat.models import ChatRoom
        user = request.user
        tenant = _resolve_tenant(request)
        if not tenant or tenant.tenant_type != 'group':
            return Response({'error': '仅集团企业可创建子公司'}, status=400)

        name = request.data.get('name', '').strip()
        tenant_type = request.data.get('tenant_type', 'company').strip()
        parent_dept_id = request.data.get('parent_dept_id')
        manager_id = request.data.get('manager_id')
        code = request.data.get('code', '').strip() or f'sub_{uuid.uuid4().hex[:8]}'

        if not name:
            return Response({'error': '请输入子公司名称'}, status=400)
        valid_types = ['company', 'branch', 'virtual']
        if tenant_type not in valid_types:
            return Response({'error': f'无效的企业类型，可选: {", ".join(valid_types)}'}, status=400)

        # 唯一编码
        unique_code = f'{tenant.code}_{code}'
        existing = set(Tenant.objects.filter(code__startswith=unique_code).values_list('code', flat=True))
        suffix = ''
        while unique_code + suffix in existing:
            suffix = '_' + uuid.uuid4().hex[:4]
        unique_code = unique_code + suffix

        try:
            from django.db import transaction
            with transaction.atomic():
                # 1. 创建子企业
                sub_tenant = Tenant.objects.create(
                    name=name, short_name=name[:20],
                    code=unique_code, tenant_type=tenant_type,
                    parent=tenant, owner=user,
                )
                # 把操作人加入子企业
                TenantMembership.objects.get_or_create(
                    user=user, tenant=sub_tenant,
                    defaults={'role': 'admin', 'is_active': True}
                )

                # 2. 创建部门
                parent_dept = None
                if parent_dept_id:
                    try:
                        parent_dept = Department.objects.get(id=int(parent_dept_id), tenant=tenant)
                    except (ValueError, Department.DoesNotExist):
                        pass
                dept = Department.objects.create(
                    tenant=tenant, name=name,
                    parent=parent_dept, code=f'dept_{sub_tenant.id}',
                    department_type='company', sort_order=0,
                    converted_tenant=sub_tenant,
                )
                # 设置负责人
                if manager_id:
                    try:
                        mgr = CustomUser.objects.get(id=int(manager_id))
                        dept.manager = mgr
                        dept.save(update_fields=['manager'])
                    except (ValueError, CustomUser.DoesNotExist):
                        pass

                # 3. 创建部门群
                group = ChatRoom.objects.create(
                    name=name, room_type='group',
                    tenant=tenant, creator=user,
                )
                dept.department_group = group
                dept.save(update_fields=['department_group'])
                # 负责人设为群主
                if dept.manager:
                    group.creator = dept.manager
                    group.save(update_fields=['creator'])

                # 4. 将操作人加入部门
                UserDepartment.objects.get_or_create(
                    user=user, department=dept,
                    defaults={'is_primary': not UserDepartment.objects.filter(user=user).exists()}
                )

                OrgChangeLog.objects.create(
                    tenant=tenant, action='create_dept',
                    department=dept, operator=user,
                    detail={'name': name, 'action': 'create_sub_tenant',
                            'sub_tenant_id': sub_tenant.id, 'sub_tenant_name': sub_tenant.name}
                )
                return Response({
                    'message': f'子公司「{name}」创建成功',
                    'tenant_id': sub_tenant.id, 'tenant_name': sub_tenant.name,
                    'department_id': dept.id, 'department_name': dept.name,
                    'group_id': group.id,
                })
        except Exception as e:
            logger.error(f'创建子公司失败: {e}')
            return Response({'error': f'创建子公司失败: {str(e)}'}, status=400)

    @action(detail=False, methods=['post'])
    def rebuild_report_relations(self, request):
        """根据当前企业组织架构自动重建汇报关系（集团模式：重建所有子企业）"""
        tenant = _resolve_tenant(request)
        if not tenant:
            return Response({'error': '请先选择企业'}, status=400)
        total_count = 0
        tenants_to_rebuild = [tenant]
        try:
            sub_ids = list(tenant.sub_tenants.filter(is_active=True).values_list('id', flat=True))
            for sid in sub_ids:
                from accounts.models import Tenant as TenantModel
                try:
                    sub = TenantModel.objects.get(id=sid)
                    tenants_to_rebuild.append(sub)
                except TenantModel.DoesNotExist:
                    pass
        except Exception:
            pass
        for t in tenants_to_rebuild:
            total_count += rebuild_report_relations(t)
        OrgChangeLog.objects.create(
            tenant=tenant, action='add_member', operator=request.user,
            detail={'action': 'rebuild_report_relations', 'count': total_count, 'tenants': len(tenants_to_rebuild)})
        return Response({'message': '汇报关系重建完成，共处理 %d 个企业，创建 %d 条记录' % (len(tenants_to_rebuild), total_count), 'count': total_count})

    @action(detail=True, methods=['post'])
    def sync_group(self, request, pk=None):
        department = self.get_object()
        if not department.department_group:
            return Response({'error': '该部门没有关联群聊'}, status=400)
        members = department.get_all_members()
        department.department_group.members.add(*list(members))
        return Response({'message': '已同步 %d 名成员' % len(members)})

    @action(detail=True, methods=['post'])
    def rebuild_group(self, request, pk=None):
        """重构部门群：根据部门名称、成员、负责人自动创建或更新部门群"""
        department = self.get_object()
        from chat.models import ChatRoom

        if department.department_group:
            # 更新已有群
            group = department.department_group
            group.name = department.name
            group.tenant = request.tenant
        else:
            # 创建新群
            group = ChatRoom.objects.create(
                name=department.name,
                room_type='group',
                tenant=request.tenant,
                creator=request.user,
            )
            department.department_group = group
            department.save(update_fields=['department_group'])

        # 设置群主：部门负责人 → 操作人
        new_owner = department.manager or request.user
        if group.creator_id != new_owner.id:
            group.creator = new_owner
        group.is_deleted = False
        group.deleted_at = None
        group.save()

        # 同步部门成员到群
        user_ids = list(UserDepartment.objects.filter(
            department=department
        ).values_list('user_id', flat=True))
        group.members.set(user_ids)

        OrgChangeLog.objects.create(
            tenant=request.tenant, action='update_dept',
            department=department, operator=request.user,
            detail={'name': department.name, 'action': 'rebuild_group',
                    'group_id': group.id, 'member_count': len(user_ids)})

        return Response({
            'message': f'部门群「{department.name}」已重构',
            'group_id': group.id, 'group_name': group.name,
            'member_count': len(user_ids),
            'owner': new_owner.real_name or new_owner.username,
        })

    @action(detail=True, methods=['post'])
    def convert_to_tenant(self, request, pk=None):
        """将部门转换为子公司（企业集团化改造）"""
        import uuid
        department = self.get_object()
        if not department.tenant:
            return Response({'error': '部门必须有所属企业'}, status=400)
        # 禁止重复转换
        if department.converted_tenant_id:
            old_t = department.converted_tenant
            return Response({'error': f'该部门已转换为子公司「{old_t.short_name or old_t.name}」，不能重复转换'}, status=400)
        from accounts.models import CustomUser, Tenant
        parent_tenant = department.tenant
        # 生成唯一编码：父企业编码_部门ID
        base_code = department.code or f'dept{department.id}'
        unique_code = f'{parent_tenant.code}_{base_code}'
        # 确保唯一
        from django.db.models import Q
        existing_codes = set(Tenant.objects.filter(
            Q(code__startswith=unique_code)
        ).values_list('code', flat=True))
        suffix = ''
        while unique_code + suffix in existing_codes:
            suffix = '_' + uuid.uuid4().hex[:4]
        unique_code = unique_code + suffix
        try:
            from django.db import transaction
            with transaction.atomic():
                sub_tenant = Tenant.objects.create(
                    name=department.name,
                    short_name=department.name[:20],
                    code=unique_code,
                    tenant_type='company',
                    parent=parent_tenant,
                    owner=request.user,
                )
                # 更新部门类型为公司，关联转换后的企业
                department.department_type = 'company'
                department.converted_tenant = sub_tenant
                department.save(update_fields=['department_type', 'converted_tenant'])
                # 将部门成员加入子企业
                user_ids = list(UserDepartment.objects.filter(
                    department=department
                ).values_list('user_id', flat=True))
                for uid in user_ids:
                    TenantMembership.objects.get_or_create(
                        user_id=uid, tenant=sub_tenant,
                        defaults={'role': 'member', 'is_active': True}
                    )
                # 将部门负责人设为子企业所有者/admin
                if department.manager:
                    TenantMembership.objects.update_or_create(
                        user=department.manager, tenant=sub_tenant,
                        defaults={'role': 'admin', 'is_active': True}
                    )
                OrgChangeLog.objects.create(
                    tenant=parent_tenant, action='update_dept',
                    department=department, operator=request.user,
                    detail={'name': department.name, 'action': 'convert_to_tenant',
                            'sub_tenant_id': sub_tenant.id, 'sub_tenant_name': sub_tenant.name,
                            'member_count': len(user_ids)})
                return Response({
                    'message': f'部门「{department.name}」已转换为子公司',
                    'tenant_id': sub_tenant.id, 'tenant_name': sub_tenant.name,
                    'member_count': len(user_ids),
                    'department_type': 'company',
                })
        except Exception as e:
            logger.error(f'部门转子公司失败: {e}')
            return Response({'error': f'部门转子公司失败: {str(e)}'}, status=400)

    @action(detail=True, methods=['post'])
    def revert_to_department(self, request, pk=None):
        """将已转换为子公司的部门恢复为普通部门"""
        department = self.get_object()
        if not department.converted_tenant_id:
            return Response({'error': '该部门不是转换后的子公司，无法恢复'}, status=400)
        sub_tenant = department.converted_tenant
        # 只允许该部门所属企业的管理员/所有者或子公司管理员操作
        tenant = getattr(request, 'tenant', None) or request.user.get_active_tenant()
        if request.user.user_type not in ('super_admin', 'admin'):
            role = request.user.get_tenant_role(tenant) if hasattr(request.user, 'get_tenant_role') else None
            if role not in ('owner', 'admin'):
                return Response({'error': '权限不足'}, status=403)
        from accounts.models import Tenant
        try:
            from django.db import transaction
            with transaction.atomic():
                # 恢复部门类型和清除转换标记
                department.department_type = 'department'
                department.converted_tenant = None
                department.save(update_fields=['department_type', 'converted_tenant'])
                # 软删除子公司（标记为不可用）
                sub_tenant.is_active = False
                sub_tenant.save(update_fields=['is_active'])
                OrgChangeLog.objects.create(
                    tenant=department.tenant, action='update_dept',
                    department=department, operator=request.user,
                    detail={'name': department.name, 'action': 'revert_to_department',
                            'old_sub_tenant_id': sub_tenant.id, 'old_sub_tenant_name': sub_tenant.name})
                return Response({
                    'message': f'部门「{department.name}」已恢复为普通部门',
                    'department_type': 'department',
                })
        except Exception as e:
            logger.error(f'子公司恢复部门失败: {e}')
            return Response({'error': f'恢复失败: {str(e)}'}, status=400)

    @action(detail=True, methods=['post'])
    def sync_all_members(self, request, pk=None):
        """将企业所有成员同步到该部门（一键同步）"""
        department = self.get_object()
        tenant = request.tenant
        members = TenantMembership.objects.filter(
            tenant=tenant, is_active=True
        ).select_related('user')
        added = 0
        added_ids = []
        for m in members:
            _, created = UserDepartment.objects.get_or_create(
                user=m.user, department=department,
                defaults={
                    'is_primary': not UserDepartment.objects.filter(user=m.user).exists()
                }
            )
            if created:
                added += 1
                added_ids.append(m.user.id)
        if added and department.auto_sync_members and department.department_group:
            all_users = [m.user for m in members if m.user.is_active]
            department.department_group.members.add(*all_users)
        OrgChangeLog.objects.create(
            tenant=tenant, action='add_member',
            department=department, operator=request.user,
            detail={'sync_all': True, 'count': added})
        self._rebuild_report_relations(tenant)
        operator_name = request.user.real_name or request.user.username
        for uid in added_ids:
            send_work_notification(
                user_id=uid, title='加入部门通知',
                content=f'您已被 {operator_name} 同步到部门「{department.name}」',
                notification_type='hr',
                related_url='/org/',
                extra_data={'department_id': department.id, 'department_name': department.name},
            )
        return Response({'message': '成功同步 %d 名成员到「%s」' % (added, department.name), 'count': added})

    @action(detail=True, methods=['get'])
    def group_status(self, request, pk=None):
        department = self.get_object()
        if not department.department_group:
            return Response({'group': None})
        g = department.department_group
        return Response({
            'group_id': g.id, 'group_name': g.name,
            'member_count': g.members.count()
        })


class OrgChartViewSet(viewsets.ViewSet):
    permission_classes = [permissions.IsAuthenticated]

    def list(self, request):
        tenant = _resolve_tenant(request)
        if not tenant:
            return Response({'org_chart': []})
        user = request.user
        user_dept_ids = set(UserDepartment.objects.filter(
            user=user
        ).values_list('department_id', flat=True))

        # 集团模式：包含子企业的根部门
        tenant_ids = [tenant.id]
        if user.user_type in ('super_admin', 'admin'):
            try:
                sub_ids = list(tenant.sub_tenants.filter(is_active=True).values_list('id', flat=True))
                if sub_ids:
                    tenant_ids.extend(sub_ids)
            except Exception:
                pass

        all_charts = []
        for tid in tenant_ids:
            t_tenant = None
            if tid != tenant.id:
                from accounts.models import Tenant as TenantModel
                try:
                    t_tenant = TenantModel.objects.get(id=tid)
                except TenantModel.DoesNotExist:
                    continue
            else:
                t_tenant = tenant
            roots = Department.objects.filter(
                tenant=t_tenant, parent__isnull=True, is_active=True
            ).order_by('sort_order')
            trees = []
            for d in roots:
                t = _build_tree(d, 0, 15, user, user_dept_ids)
                if t:
                    t['_tenant_name'] = t_tenant.short_name or t_tenant.name if t_tenant else ''
                    trees.append(t)
            if trees:
                all_charts.append({
                    'tenant_id': t_tenant.id if t_tenant else tid,
                    'tenant_name': t_tenant.short_name or t_tenant.name if t_tenant else '',
                    'org_chart': trees,
                })

        result = {
            'tenant': tenant.name, 'tenant_id': tenant.id,
            'org_chart': all_charts[0]['org_chart'] if len(all_charts) == 1 else [],
            'tenants': all_charts if len(all_charts) > 1 else None,
        }
        return Response(result)


class UserDepartmentViewSet(viewsets.GenericViewSet):
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = UserDepartmentSerializer

    @action(detail=True, methods=['get'])
    def departments(self, request, pk=None):
        try:
            user = CustomUser.objects.get(id=pk)
        except CustomUser.DoesNotExist:
            return Response({'error': '用户不存在'}, status=404)
        rels = UserDepartment.objects.filter(
            user=user, department__tenant=request.tenant
        ).select_related('department')
        return Response({'results': [{
            'department_id': r.department_id,
            'department_name': r.department.name,
            'is_primary': r.is_primary, 'position': r.position,
        } for r in rels]})

    @action(detail=True, methods=['post'])
    def set_primary_dept(self, request, pk=None):
        try:
            user = CustomUser.objects.get(id=pk)
        except CustomUser.DoesNotExist:
            return Response({'error': '用户不存在'}, status=404)
        dept_id = request.data.get('department_id')
        if not dept_id:
            return Response({'error': '缺少部门ID'}, status=400)
        UserDepartment.objects.filter(user=user, is_primary=True).update(
            is_primary=False)
        UserDepartment.objects.filter(
            user=user, department_id=dept_id).update(is_primary=True)
        return Response({'message': '主部门已设置'})

    @action(detail=True, methods=['get'])
    def subordinates(self, request, pk=None):
        try:
            user = CustomUser.objects.get(id=pk)
        except CustomUser.DoesNotExist:
            return Response({'error': '用户不存在'}, status=404)
        rels = ReportRelation.objects.filter(
            supervisor=user, tenant=request.tenant
        ).select_related('user', 'department')
        return Response({'results': [{
            'id': r.user.id, 'username': r.user.username,
            'real_name': r.user.real_name or '',
            'avatar': r.user.get_avatar_url(),
            'position': r.user.position or '',
            'department_id': r.department_id,
            'department_name': r.department.name,
            'is_direct': r.is_direct,
        } for r in rels]})

    @action(detail=True, methods=['get'])
    def supervisors(self, request, pk=None):
        """获取某人的直属上级"""
        try:
            user = CustomUser.objects.get(id=pk)
        except CustomUser.DoesNotExist:
            return Response({'error': '用户不存在'}, status=404)
        rels = ReportRelation.objects.filter(
            user=user, tenant=request.tenant
        ).select_related('supervisor', 'department')
        return Response({'results': [{
            'id': r.supervisor.id, 'username': r.supervisor.username,
            'real_name': r.supervisor.real_name or '',
            'avatar': r.supervisor.get_avatar_url(),
            'position': r.supervisor.position or '',
            'department_id': r.department_id,
            'department_name': r.department.name,
            'is_direct': r.is_direct,
        } for r in rels]})

    @action(detail=True, methods=['post'])
    def set_supervisor(self, request, pk=None):
        try:
            user = CustomUser.objects.get(id=pk)
        except CustomUser.DoesNotExist:
            return Response({'error': '用户不存在'}, status=404)
        sup_id = request.data.get('supervisor_id')
        dept_id = request.data.get('department_id')
        if not sup_id or not dept_id:
            return Response({'error': '缺少参数'}, status=400)
        rel, created = ReportRelation.objects.update_or_create(
            user=user, department_id=dept_id,
            defaults={
                'supervisor_id': sup_id,
                'tenant': request.tenant,
                'is_direct': True,
            }
        )
        operator_name = request.user.real_name or request.user.username
        send_work_notification(
            user_id=sup_id, title='汇报关系通知',
            content=f'{operator_name} 将 {user.real_name or user.username} 设置为您的下属（{rel.department.name}）',
            notification_type='hr', related_url='/org/',
            extra_data={'user_id': user.id, 'department_id': dept_id},
        )
        return Response({'message': '直属上级已设置', 'created': created})


class OrgChangeLogViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = OrgChangeLogSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        tenant = self.request.tenant
        if not tenant:
            return OrgChangeLog.objects.none()
        return OrgChangeLog.objects.filter(tenant=tenant).order_by('-created_at')
