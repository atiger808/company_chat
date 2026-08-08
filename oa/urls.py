from django.urls import path
from .views import AttendanceViewSet, ApprovalViewSet, ApprovalTypeViewSet, WorkNotificationViewSet

urlpatterns = [
    # 考勤打卡
    path('attendance/clock-in/', AttendanceViewSet.as_view({'post': 'clock_in'}), name='attendance-clock-in'),
    path('attendance/clock-out/', AttendanceViewSet.as_view({'post': 'clock_out'}), name='attendance-clock-out'),
    path('attendance/today/', AttendanceViewSet.as_view({'get': 'today'}), name='attendance-today'),
    path('attendance/statistics/', AttendanceViewSet.as_view({'get': 'statistics'}), name='attendance-statistics'),
    path('attendance/export/', AttendanceViewSet.as_view({'get': 'export'}), name='attendance-export'),
    path('attendance/', AttendanceViewSet.as_view({'get': 'list'}), name='attendance-list'),
    path('attendance/<int:pk>/', AttendanceViewSet.as_view({'get': 'retrieve'}), name='attendance-detail'),
    path('attendance/<int:pk>/convert-coords/', AttendanceViewSet.as_view({'get': 'convert_coords'}), name='attendance-convert-coords'),
    path('attendance/attendance-configs/', AttendanceViewSet.as_view({'get': 'attendance_configs'}), name='attendance-configs'),
    path('attendance/save-attendance-config/', AttendanceViewSet.as_view({'post': 'save_attendance_config'}), name='save-attendance-config'),
    path('attendance/delete-attendance-config/<int:pk>/', AttendanceViewSet.as_view({'delete': 'delete_attendance_config'}), name='delete-attendance-config'),
    path('attendance/my-config/', AttendanceViewSet.as_view({'get': 'resolve_my_config'}), name='resolve-my-config'),
    path('attendance/calendar-stats/', AttendanceViewSet.as_view({'get': 'calendar_stats'}), name='attendance-calendar-stats'),
    path('attendance/calendar-day-detail/', AttendanceViewSet.as_view({'get': 'calendar_day_detail'}), name='attendance-calendar-day-detail'),

    # OA审批
    path('approval/approval_chain/', ApprovalViewSet.as_view({'get': 'approval_chain'}), name='approval-approval-chain'),
    path('approval/geocode/', ApprovalViewSet.as_view({'get': 'geocode'}), name='approval-geocode'),
    path('approval/admins/', ApprovalViewSet.as_view({'get': 'admins'}), name='approval-admins'),
    path('approval/departments/', ApprovalViewSet.as_view({'get': 'departments'}), name='approval-departments'),
    path('approval/all-departments/', ApprovalViewSet.as_view({'get': 'all_departments'}), name='approval-all-departments'),
    path('approval/org_departments/', ApprovalViewSet.as_view({'get': 'org_departments'}), name='approval-org-departments'),
    path('approval/upload-attachment/', ApprovalViewSet.as_view({'post': 'upload_attachment'}), name='approval-upload'),
    path('approval/dept-configs/', ApprovalViewSet.as_view({'get': 'dept_configs'}), name='approval-dept-configs'),
    path('approval/save-dept-config/', ApprovalViewSet.as_view({'post': 'save_dept_config'}), name='approval-save-dept-config'),
    path('approval/delete-dept-config/<int:pk>/', ApprovalViewSet.as_view({'delete': 'delete_dept_config'}), name='approval-delete-dept-config'),
    path('approval/search-cc-users/', ApprovalViewSet.as_view({'get': 'search_cc_users'}), name='approval-search-cc-users'),
    path('approval/search-cc-departments/', ApprovalViewSet.as_view({'get': 'search_cc_departments'}), name='approval-search-cc-departments'),
    path('approval/my-pending/', ApprovalViewSet.as_view({'get': 'my_pending'}), name='approval-my-pending'),
    path('approval/draft/', ApprovalViewSet.as_view({'post': 'draft'}), name='approval-draft'),
    path('approval/drafts/', ApprovalViewSet.as_view({'get': 'drafts'}), name='approval-drafts'),
    # 审批类型管理（动态自定义类型）
    path('approval/types/', ApprovalTypeViewSet.as_view({'get': 'list', 'post': 'create'}), name='approval-types'),
    path('approval/types/<int:pk>/', ApprovalTypeViewSet.as_view({'put': 'update', 'patch': 'update', 'delete': 'destroy'}), name='approval-type-detail'),
    path('approval/', ApprovalViewSet.as_view({'get': 'list', 'post': 'create'}), name='approval-list'),
    path('approval/<int:pk>/', ApprovalViewSet.as_view({'get': 'retrieve'}), name='approval-detail'),
    path('approval/<int:pk>/approve/', ApprovalViewSet.as_view({'post': 'approve'}), name='approval-approve'),
    path('approval/<int:pk>/reject/', ApprovalViewSet.as_view({'post': 'reject'}), name='approval-reject'),
    path('approval/<int:pk>/deferred/', ApprovalViewSet.as_view({'post': 'deferred'}), name='approval-deferred'),
    path('approval/<int:pk>/processing/', ApprovalViewSet.as_view({'post': 'processing'}), name='approval-processing'),
    path('approval/<int:pk>/cancel/', ApprovalViewSet.as_view({'post': 'cancel'}), name='approval-cancel'),
    path('approval/<int:pk>/re-edit/', ApprovalViewSet.as_view({'post': 're_edit'}), name='approval-re-edit'),
    path('approval/<int:pk>/delete-draft/', ApprovalViewSet.as_view({'delete': 'delete_draft'}), name='approval-delete-draft'),
    path('approval/<int:pk>/update-draft/', ApprovalViewSet.as_view({'post': 'update_draft'}), name='approval-update-draft'),

    # 工作通知
    path('notifications/', WorkNotificationViewSet.as_view({'get': 'list'}), name='notification-list'),
    path('notifications/unread-count/', WorkNotificationViewSet.as_view({'get': 'unread_count'}), name='notification-unread-count'),
    path('notifications/mark-all-read/', WorkNotificationViewSet.as_view({'post': 'mark_all_read'}), name='notification-mark-all-read'),
    path('notifications/<int:pk>/mark-read/', WorkNotificationViewSet.as_view({'post': 'mark_read'}), name='notification-mark-read'),
]
