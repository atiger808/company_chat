# Generated manually — SeparateDatabaseAndState wraps all operations
# because LoginLog, OperationLog tables and all columns/indexes already
# exist in the database but were never registered in Django migrations.
from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0003_consultationrequest'),
    ]

    state_operations = [
        migrations.CreateModel(
            name='LoginLog',
            fields=[
                ('modifier', models.CharField(blank=True, help_text='修改人', max_length=255, null=True, verbose_name='修改人')),
                ('dept_belong_id', models.CharField(blank=True, help_text='数据归属部门', max_length=255, null=True, verbose_name='数据归属部门')),
                ('update_time', models.DateTimeField(auto_now=True, db_index=True, help_text='修改时间', null=True, verbose_name='修改时间')),
                ('create_time', models.DateTimeField(auto_now_add=True, db_index=True, help_text='创建时间', null=True, verbose_name='创建时间')),
                ('id', models.BigAutoField(help_text='Id', primary_key=True, serialize=False, verbose_name='Id')),
                ('description', models.CharField(blank=True, help_text='描述', max_length=255, null=True, verbose_name='描述')),
                ('username', models.CharField(blank=True, db_index=True, help_text='登录用户名', max_length=32, null=True, verbose_name='登录用户名')),
                ('ip', models.CharField(blank=True, db_index=True, help_text='登录ip', max_length=50, null=True, verbose_name='登录ip')),
                ('agent', models.TextField(blank=True, help_text='agent信息', null=True, verbose_name='agent信息')),
                ('browser', models.CharField(blank=True, db_index=True, help_text='浏览器名', max_length=200, null=True, verbose_name='浏览器名')),
                ('os', models.CharField(blank=True, db_index=True, help_text='操作系统', max_length=200, null=True, verbose_name='操作系统')),
                ('continent', models.CharField(blank=True, db_index=True, help_text='洲', max_length=50, null=True, verbose_name='州')),
                ('country', models.CharField(blank=True, db_index=True, help_text='国家', max_length=50, null=True, verbose_name='国家')),
                ('province', models.CharField(blank=True, db_index=True, help_text='省份', max_length=50, null=True, verbose_name='省份')),
                ('city', models.CharField(blank=True, db_index=True, help_text='城市', max_length=50, null=True, verbose_name='城市')),
                ('district', models.CharField(blank=True, db_index=True, help_text='县区', max_length=50, null=True, verbose_name='县区')),
                ('isp', models.CharField(blank=True, db_index=True, help_text='运营商', max_length=50, null=True, verbose_name='运营商')),
                ('area_code', models.CharField(blank=True, db_index=True, help_text='区域代码', max_length=50, null=True, verbose_name='区域代码')),
                ('country_english', models.CharField(blank=True, db_index=True, help_text='英文全称', max_length=50, null=True, verbose_name='英文全称')),
                ('country_code', models.CharField(blank=True, db_index=True, help_text='简称', max_length=50, null=True, verbose_name='简称')),
                ('longitude', models.CharField(blank=True, help_text='经度', max_length=50, null=True, verbose_name='经度')),
                ('latitude', models.CharField(blank=True, help_text='纬度', max_length=50, null=True, verbose_name='纬度')),
                ('login_type', models.IntegerField(choices=[(1, '普通登录'), (2, '扫码登录'), (3, '邮箱登录')], db_index=True, default=1, help_text='登录类型', verbose_name='登录类型')),
                ('creator', models.ForeignKey(db_constraint=False, help_text='创建人', null=True, on_delete=django.db.models.deletion.SET_NULL, related_query_name='creator_query', to=settings.AUTH_USER_MODEL, verbose_name='创建人')),
            ],
            options={
                'verbose_name': '登录日志',
                'verbose_name_plural': '登录日志',
                'db_table': 'login_log',
                'ordering': ('-create_time',),
            },
        ),
        migrations.CreateModel(
            name='OperationLog',
            fields=[
                ('id', models.BigAutoField(help_text='Id', primary_key=True, serialize=False, verbose_name='Id')),
                ('description', models.CharField(blank=True, help_text='描述', max_length=255, null=True, verbose_name='描述')),
                ('modifier', models.CharField(blank=True, help_text='修改人', max_length=255, null=True, verbose_name='修改人')),
                ('dept_belong_id', models.CharField(blank=True, help_text='数据归属部门', max_length=255, null=True, verbose_name='数据归属部门')),
                ('update_time', models.DateTimeField(auto_now=True, db_index=True, help_text='修改时间', null=True, verbose_name='修改时间')),
                ('create_time', models.DateTimeField(auto_now_add=True, db_index=True, help_text='创建时间', null=True, verbose_name='创建时间')),
                ('request_modular', models.CharField(blank=True, db_index=True, help_text='请求模块', max_length=64, null=True, verbose_name='请求模块')),
                ('request_path', models.CharField(blank=True, help_text='请求地址', max_length=400, null=True, verbose_name='请求地址')),
                ('request_body', models.TextField(blank=True, help_text='请求参数', null=True, verbose_name='请求参数')),
                ('request_method', models.CharField(blank=True, db_index=True, help_text='请求方式', max_length=8, null=True, verbose_name='请求方式')),
                ('request_msg', models.TextField(blank=True, help_text='操作说明', null=True, verbose_name='操作说明')),
                ('request_ip', models.CharField(blank=True, db_index=True, help_text='请求ip地址', max_length=50, null=True, verbose_name='请求ip地址')),
                ('request_browser', models.CharField(blank=True, db_index=True, help_text='请求浏览器', max_length=64, null=True, verbose_name='请求浏览器')),
                ('response_code', models.CharField(blank=True, db_index=True, help_text='响应状态码', max_length=64, null=True, verbose_name='响应状态码')),
                ('request_os', models.CharField(blank=True, db_index=True, help_text='操作系统', max_length=64, null=True, verbose_name='操作系统')),
                ('json_result', models.TextField(blank=True, help_text='返回信息', null=True, verbose_name='返回信息')),
                ('status', models.BooleanField(db_index=True, default=False, help_text='响应状态', verbose_name='响应状态')),
                ('creator', models.ForeignKey(db_constraint=False, help_text='创建人', null=True, on_delete=django.db.models.deletion.SET_NULL, related_query_name='creator_query', to=settings.AUTH_USER_MODEL, verbose_name='创建人')),
            ],
            options={
                'verbose_name': '操作日志',
                'verbose_name_plural': '操作日志',
                'db_table': 'operation_log',
                'ordering': ('-create_time',),
            },
        ),
        migrations.AddField(
            model_name='customuser',
            name='is_staff',
            field=models.BooleanField(default=False, help_text='Designates whether the user can log into this admin site.', verbose_name='staff status'),
        ),
        migrations.AlterField(
            model_name='customuser',
            name='id',
            field=models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID'),
        ),
        migrations.AlterField(
            model_name='department',
            name='id',
            field=models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID'),
        ),
        migrations.AlterField(
            model_name='useractivity',
            name='id',
            field=models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID'),
        ),
        migrations.AddIndex(
            model_name='customuser',
            index=models.Index(fields=['username'], name='accounts_cu_usernam_ab560e_idx'),
        ),
        migrations.AddIndex(
            model_name='customuser',
            index=models.Index(fields=['real_name'], name='accounts_cu_real_na_882989_idx'),
        ),
        migrations.AddIndex(
            model_name='customuser',
            index=models.Index(fields=['email'], name='accounts_cu_email_5ce40b_idx'),
        ),
        migrations.AddIndex(
            model_name='customuser',
            index=models.Index(fields=['is_online', 'last_login', 'is_active'], name='accounts_cu_is_onli_55bfea_idx'),
        ),
        migrations.AddIndex(
            model_name='useractivity',
            index=models.Index(fields=['user', '-created_at'], name='accounts_us_user_id_506163_idx'),
        ),
        migrations.AddIndex(
            model_name='loginlog',
            index=models.Index(fields=['create_time'], name='login_log_create__aac598_idx'),
        ),
        migrations.AddIndex(
            model_name='loginlog',
            index=models.Index(fields=['creator', 'create_time'], name='login_log_creator_680638_idx'),
        ),
        migrations.AddIndex(
            model_name='loginlog',
            index=models.Index(fields=['username', 'create_time'], name='login_log_usernam_ed5fb5_idx'),
        ),
        migrations.AddIndex(
            model_name='loginlog',
            index=models.Index(fields=['ip', 'create_time'], name='login_log_ip_5a1a64_idx'),
        ),
        migrations.AddIndex(
            model_name='loginlog',
            index=models.Index(fields=['os', 'create_time'], name='login_log_os_7540bf_idx'),
        ),
        migrations.AddIndex(
            model_name='loginlog',
            index=models.Index(fields=['country', 'province', 'city'], name='login_log_country_551ab9_idx'),
        ),
        migrations.AddIndex(
            model_name='loginlog',
            index=models.Index(fields=['login_type', 'create_time'], name='login_log_login_t_f19502_idx'),
        ),
        migrations.AddIndex(
            model_name='loginlog',
            index=models.Index(fields=['creator', 'create_time', 'username'], name='login_log_creator_77e937_idx'),
        ),
        migrations.AddIndex(
            model_name='loginlog',
            index=models.Index(fields=['ip', 'create_time', 'username'], name='login_log_ip_738067_idx'),
        ),
        migrations.AddIndex(
            model_name='operationlog',
            index=models.Index(fields=['create_time'], name='operation_l_create__33a8d5_idx'),
        ),
        migrations.AddIndex(
            model_name='operationlog',
            index=models.Index(fields=['creator', 'create_time'], name='operation_l_creator_058bee_idx'),
        ),
        migrations.AddIndex(
            model_name='operationlog',
            index=models.Index(fields=['status', 'create_time'], name='operation_l_status_df2945_idx'),
        ),
        migrations.AddIndex(
            model_name='operationlog',
            index=models.Index(fields=['request_modular', 'create_time'], name='operation_l_request_7a0f02_idx'),
        ),
        migrations.AddIndex(
            model_name='operationlog',
            index=models.Index(fields=['creator', 'status'], name='operation_l_creator_c5f26c_idx'),
        ),
        migrations.AddIndex(
            model_name='operationlog',
            index=models.Index(fields=['creator', 'create_time', 'status'], name='operation_l_creator_817c22_idx'),
        ),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(state_operations=state_operations)
    ]
