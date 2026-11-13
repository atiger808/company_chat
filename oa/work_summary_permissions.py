# -*- coding: utf-8 -*-
"""每日工作总结·团队总结部门权限解析。

规则：
- 超级管理员始终拥有全部权限；本人对自己总结拥有全部权限。
- 每个部门可配置「负责人 / 副负责人 / 全体成员 / 指定成员」是否获得
  查看、点赞、评论、打印、导出、分享权限（以查看为前提）。
- 未配置权限的部门沿用旧规则：该部门负责人/副负责人（含子部门）可查看。
"""
from django.db.models import Q

from accounts.models import Department
from org.models import UserDepartment
from .models import WorkSummaryDeptPermission

ACTIONS = ('view', 'like', 'comment', 'print', 'export', 'share')


def all_actions():
    return {a: True for a in ACTIONS}


def no_actions():
    return {a: False for a in ACTIONS}


class WorkSummaryPermissionResolver:
    """一次请求内复用的权限解析器（配置/部门树/成员部门均做缓存）。"""

    def __init__(self, user, tenant):
        self.user = user
        self.tenant = tenant
        self.configs = []
        self._tree_cache = {}
        self._user_dept_cache = {}
        self._actions_cache = {}
        self._config_deputy_cache = {}
        try:
            if tenant is None:
                self.configs = []
            else:
                # 同时兼容配置写在上级集团、成员属于子公司的情况
                tenant_ids, cur, depth = [tenant.id], tenant, 0
                while cur.parent_id and depth < 10:
                    cur = cur.parent
                    tenant_ids.append(cur.id)
                    depth += 1
                self.configs = list(WorkSummaryDeptPermission.objects
                                    .filter(tenant_id__in=tenant_ids)
                                    .select_related('department'))
        except Exception:
            self.configs = []

    # ---------- 基础数据 ----------
    def dept_tree(self, root_id):
        """部门自身 + 所有子部门 ID。"""
        if root_id in self._tree_cache:
            return self._tree_cache[root_id]
        ids, stack = set(), [root_id]
        while stack:
            did = stack.pop()
            if did in ids:
                continue
            ids.add(did)
            stack.extend(Department.objects.filter(parent_id=did).values_list('id', flat=True))
        self._tree_cache[root_id] = ids
        return ids

    def user_dept_ids(self, user):
        """用户可归属的部门：组织架构关系 + 主部门 + 其担任负责人/副负责人的部门。"""
        if not user:
            return set()
        if user.id in self._user_dept_cache:
            return self._user_dept_cache[user.id]
        ids = set(UserDepartment.objects.filter(user=user)
                  .values_list('department_id', flat=True))
        if getattr(user, 'department_id', None):
            ids.add(user.department_id)
        ids.update(Department.objects.filter(manager=user).values_list('id', flat=True))
        ids.update(Department.objects.filter(deputy_managers=user).values_list('id', flat=True))
        self._user_dept_cache[user.id] = ids
        return ids

    def managed_roots(self):
        """用户担任负责人/副负责人的部门（不含子部门）。"""
        return list(Department.objects.filter(
            Q(manager=self.user) | Q(deputy_managers=self.user)).distinct())

    def configured_dept_ids(self):
        return {c.department_id for c in self.configs}

    def _is_deputy(self, cfg):
        key = cfg.department_id
        if key not in self._config_deputy_cache:
            try:
                self._config_deputy_cache[key] = cfg.department.deputy_managers.filter(
                    id=self.user.id).exists()
            except Exception:
                self._config_deputy_cache[key] = False
        return self._config_deputy_cache[key]

    def qualifies(self, cfg, tree_ids=None):
        """当前用户是否属于该部门权限配置的授权范围。"""
        dept = cfg.department
        if cfg.include_manager and dept.manager_id == self.user.id:
            return True
        if cfg.include_deputy and self._is_deputy(cfg):
            return True
        member_ids = set(cfg.member_ids or [])
        if self.user.id in member_ids:
            return True
        if cfg.include_all_members:
            tree_ids = tree_ids if tree_ids is not None else self.dept_tree(dept.id)
            if self.user_dept_ids(self.user) & tree_ids:
                return True
        return False

    # ---------- 单篇总结权限 ----------
    def actions_for(self, summary):
        if not self.user or not getattr(self.user, 'is_authenticated', False):
            return no_actions()
        if summary.user_id == getattr(self.user, 'id', None):
            return all_actions()
        if getattr(self.user, 'user_type', '') == 'super_admin':
            return all_actions()
        if summary.id in self._actions_cache:
            return self._actions_cache[summary.id]

        result = no_actions()
        author_dept_ids = self.user_dept_ids(summary.user)
        if not author_dept_ids:
            self._actions_cache[summary.id] = result
            return result

        for cfg in self.configs:
            tree = self.dept_tree(cfg.department_id)
            if not (author_dept_ids & tree):
                continue
            if not self.qualifies(cfg, tree):
                continue
            if not cfg.can_view:
                continue
            for action in ACTIONS:
                if action == 'view' or getattr(cfg, 'can_' + action, False):
                    result[action] = True

        # 未配置的部门：沿用负责人/副负责人可见的旧规则
        configured = self.configured_dept_ids()
        for root in self.managed_roots():
            if root.id in configured:
                continue
            if author_dept_ids & self.dept_tree(root.id):
                result = all_actions()
                break

        self._actions_cache[summary.id] = result
        return result

    def can(self, summary, action):
        return bool(self.actions_for(summary).get(action))

    # ---------- 团队列表范围 ----------
    def scope(self):
        """返回 dict：dept_ids / user_ids / can_manage / allowed_department_ids。

        super_admin 的 user_ids 为 None（不限制）。普通用户没有任何可查看部门时
        dept_ids 为空，调用方应返回 403/空列表。
        """
        if getattr(self.user, 'user_type', '') == 'super_admin':
            return {'dept_ids': None, 'user_ids': None, 'can_manage': True,
                    'allowed_department_ids': None}

        dept_ids = set()
        for cfg in self.configs:
            if not cfg.can_view:
                continue
            tree = self.dept_tree(cfg.department_id)
            if self.qualifies(cfg, tree):
                dept_ids |= tree

        managed = self.managed_roots()
        configured = self.configured_dept_ids()
        for root in managed:
            if root.id in configured:
                continue
            dept_ids |= self.dept_tree(root.id)

        if not dept_ids:
            return {'dept_ids': set(), 'user_ids': set(), 'can_manage': bool(managed),
                    'allowed_department_ids': []}

        user_ids = set(
            UserDepartment.objects.filter(department_id__in=dept_ids)
            .values_list('user_id', flat=True))
        depts = Department.objects.filter(id__in=dept_ids).prefetch_related('deputy_managers')
        for d in depts:
            if d.manager_id:
                user_ids.add(d.manager_id)
            try:
                user_ids.update(d.deputy_managers.values_list('id', flat=True))
            except Exception:
                pass
        # 兼容历史 user.department 字段
        from accounts.models import CustomUser
        user_ids.update(
            CustomUser.objects.filter(department_id__in=dept_ids)
            .values_list('id', flat=True))

        return {
            'dept_ids': dept_ids,
            'user_ids': user_ids,
            'can_manage': bool(managed),
            'allowed_department_ids': sorted(dept_ids),
        }
