from django.urls import path
from .views import AttendanceViewSet, ApprovalViewSet, WorkNotificationViewSet

urlpatterns = [
    # 考勤打卡
    path('attendance/clock-in/', AttendanceViewSet.as_view({'post': 'clock_in'}), name='attendance-clock-in'),
    path('attendance/clock-out/', AttendanceViewSet.as_view({'post': 'clock_out'}), name='attendance-clock-out'),
    path('attendance/today/', AttendanceViewSet.as_view({'get': 'today'}), name='attendance-today'),
    path('attendance/statistics/', AttendanceViewSet.as_view({'get': 'statistics'}), name='attendance-statistics'),
    path('attendance/', AttendanceViewSet.as_view({'get': 'list'}), name='attendance-list'),
    path('attendance/<int:pk>/', AttendanceViewSet.as_view({'get': 'retrieve'}), name='attendance-detail'),

    # OA审批
    path('approval/geocode/', ApprovalViewSet.as_view({'get': 'geocode'}), name='approval-geocode'),
    path('approval/admins/', ApprovalViewSet.as_view({'get': 'admins'}), name='approval-admins'),
    path('approval/departments/', ApprovalViewSet.as_view({'get': 'departments'}), name='approval-departments'),
    path('approval/all-departments/', ApprovalViewSet.as_view({'get': 'all_departments'}), name='approval-all-departments'),
    path('approval/upload-attachment/', ApprovalViewSet.as_view({'post': 'upload_attachment'}), name='approval-upload'),
    path('approval/my-pending/', ApprovalViewSet.as_view({'get': 'my_pending'}), name='approval-my-pending'),
    path('approval/', ApprovalViewSet.as_view({'get': 'list', 'post': 'create'}), name='approval-list'),
    path('approval/<int:pk>/', ApprovalViewSet.as_view({'get': 'retrieve'}), name='approval-detail'),
    path('approval/<int:pk>/approve/', ApprovalViewSet.as_view({'post': 'approve'}), name='approval-approve'),
    path('approval/<int:pk>/reject/', ApprovalViewSet.as_view({'post': 'reject'}), name='approval-reject'),

    # 工作通知
    path('notifications/', WorkNotificationViewSet.as_view({'get': 'list'}), name='notification-list'),
    path('notifications/unread-count/', WorkNotificationViewSet.as_view({'get': 'unread_count'}), name='notification-unread-count'),
    path('notifications/mark-all-read/', WorkNotificationViewSet.as_view({'post': 'mark_all_read'}), name='notification-mark-all-read'),
    path('notifications/<int:pk>/mark-read/', WorkNotificationViewSet.as_view({'post': 'mark_read'}), name='notification-mark-read'),
]
