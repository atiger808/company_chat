# Generated manually to satisfy migration graph dependency
from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
import django.contrib.auth.models
import django.contrib.auth.validators
import django.core.validators


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        ('auth', '0011_update_proxy_permissions'),
    ]

    operations = [
        migrations.CreateModel(
            name='Department',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=100, unique=True, verbose_name='部门名称')),
                ('code', models.CharField(blank=True, default='', max_length=50, verbose_name='部门编码')),
                ('updated_at', models.DateTimeField(auto_now=True, verbose_name='更新时间')),
                ('created_at', models.DateTimeField(auto_now_add=True, verbose_name='创建时间')),
                ('parent', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, to='accounts.department', verbose_name='上级部门')),
            ],
            options={
                'verbose_name': '部门',
                'verbose_name_plural': '部门',
                'ordering': ['name'],
            },
        ),
        migrations.CreateModel(
            name='CustomUser',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('password', models.CharField(max_length=128, verbose_name='password')),
                ('last_login', models.DateTimeField(blank=True, null=True, verbose_name='last login')),
                ('is_superuser', models.BooleanField(default=False, help_text='Designates that this user has all permissions without explicitly assigning them.', verbose_name='superuser status')),
                ('username', models.CharField(error_messages={'unique': 'A user with that username already exists.'}, help_text='Required. 150 characters or fewer. Letters, digits and @/./+/-/_ only.', max_length=150, unique=True, validators=[django.contrib.auth.validators.UnicodeUsernameValidator()], verbose_name='username')),
                ('first_name', models.CharField(blank=True, max_length=150, verbose_name='first name')),
                ('last_name', models.CharField(blank=True, max_length=150, verbose_name='last name')),
                ('date_joined', models.DateTimeField(default=django.utils.timezone.now, verbose_name='date joined')),
                ('email', models.EmailField(max_length=254, unique=True, verbose_name='邮箱')),
                ('phone', models.CharField(blank=True, max_length=20, null=True, validators=[django.core.validators.RegexValidator(message='请输入有效的中国大陆手机号', regex='^1[3-9]\\d{9}$')], verbose_name='手机号')),
                ('real_name', models.CharField(blank=True, default='', max_length=100, null=True, verbose_name='真实姓名')),
                ('position', models.CharField(blank=True, max_length=100, null=True, verbose_name='职位')),
                ('user_type', models.CharField(choices=[('super_admin', '超级管理员'), ('admin', '管理员'), ('normal', '普通用户'), ('visitor', '访客')], default='normal', max_length=20, verbose_name='用户类型')),
                ('avatar', models.ImageField(blank=True, default='avatars/default-avatar.png', null=True, upload_to='avatars/', validators=[django.core.validators.FileExtensionValidator(allowed_extensions=['jpg', 'jpeg', 'png', 'gif', 'webp'])], verbose_name='头像')),
                ('gender', models.CharField(blank=True, choices=[('male', '男'), ('female', '女'), ('other', '其他')], max_length=10, null=True, verbose_name='性别')),
                ('bio', models.TextField(blank=True, max_length=500, null=True, verbose_name='个人简介')),
                ('is_online', models.BooleanField(default=False, verbose_name='在线状态')),
                ('last_seen', models.DateTimeField(blank=True, null=True, verbose_name='最后在线时间')),
                ('is_active', models.BooleanField(default=True, verbose_name='是否启用')),
                ('login_attempts', models.IntegerField(default=0, verbose_name='登录失败次数')),
                ('last_failed_login', models.DateTimeField(blank=True, null=True, verbose_name='最后登录失败时间')),
                ('password_reset_token', models.CharField(blank=True, max_length=255, null=True, verbose_name='密码重置令牌')),
                ('password_reset_token_expires', models.DateTimeField(blank=True, null=True, verbose_name='令牌过期时间')),
                ('last_password_change', models.DateTimeField(blank=True, null=True, verbose_name='上次密码修改时间')),
                ('email_verified', models.BooleanField(default=False, verbose_name='邮箱已验证')),
                ('email_verified_at', models.DateTimeField(blank=True, null=True, verbose_name='邮箱验证时间')),
                ('phone_verified', models.BooleanField(default=False, verbose_name='手机已验证')),
                ('phone_verified_at', models.DateTimeField(blank=True, null=True, verbose_name='手机验证时间')),
                ('department', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, to='accounts.department', verbose_name='部门')),
                ('friends', models.ManyToManyField(blank=True, related_name='friend_of', to='accounts.CustomUser', verbose_name='好友列表')),
                ('groups', models.ManyToManyField(blank=True, help_text='用户所属的组', related_name='customuser_set', related_query_name='customuser', to='auth.Group', verbose_name='用户组')),
                ('user_permissions', models.ManyToManyField(blank=True, help_text='用户特定的权限', related_name='customuser_set', related_query_name='customuser', to='auth.Permission', verbose_name='用户权限')),
            ],
            options={
                'verbose_name': '用户',
                'verbose_name_plural': '用户',
                'ordering': ['-date_joined'],
            },
            managers=[
                ('objects', django.contrib.auth.models.UserManager()),
            ],
        ),
        migrations.AddField(
            model_name='department',
            name='manager',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='managed_departments', to=settings.AUTH_USER_MODEL, verbose_name='部门负责人'),
        ),
        migrations.CreateModel(
            name='UserActivity',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('action', models.CharField(choices=[('login', '登录'), ('logout', '登出'), ('message', '发送消息'), ('file_upload', '上传文件'), ('room_create', '创建聊天室'), ('room_join', '加入聊天室'), ('room_leave', '离开聊天室')], max_length=50, verbose_name='操作类型')),
                ('description', models.TextField(blank=True, null=True, verbose_name='描述')),
                ('ip_address', models.GenericIPAddressField(blank=True, null=True, verbose_name='IP地址')),
                ('created_at', models.DateTimeField(auto_now_add=True, verbose_name='创建时间')),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='activities', to=settings.AUTH_USER_MODEL, verbose_name='用户')),
            ],
            options={
                'verbose_name': '用户活动',
                'verbose_name_plural': '用户活动',
                'ordering': ['-created_at'],
            },
        ),
        migrations.CreateModel(
            name='ConsultationRequest',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('company_name', models.CharField(max_length=200, verbose_name='公司名称')),
                ('contact_name', models.CharField(max_length=100, verbose_name='联系人姓名')),
                ('email', models.EmailField(max_length=254, verbose_name='企业邮箱')),
                ('phone', models.CharField(max_length=20, verbose_name='联系电话')),
                ('demand_type', models.CharField(choices=[('private', '私有化部署'), ('saas', 'SaaS 云端订阅'), ('custom', '深度定制开发'), ('poc', '申请免费 POC 测试环境')], default='private', max_length=20, verbose_name='期望部署方式')),
                ('message', models.TextField(blank=True, null=True, verbose_name='需求描述')),
                ('status', models.CharField(choices=[('pending', '待处理'), ('contacted', '已联系'), ('closed', '已关闭')], default='pending', max_length=20, verbose_name='处理状态')),
                ('created_at', models.DateTimeField(auto_now_add=True, verbose_name='提交时间')),
                ('handled_at', models.DateTimeField(blank=True, null=True, verbose_name='处理时间')),
                ('admin_notes', models.TextField(blank=True, null=True, verbose_name='管理员备注')),
            ],
            options={
                'verbose_name': '咨询请求',
                'verbose_name_plural': '咨询请求',
                'ordering': ['-created_at'],
            },
        ),
    ]
