from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0001_initial'),
        ('oa', '0001_initial'),
    ]

    operations = [
        migrations.AddField(
            model_name='approvalrequest',
            name='department',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='approval_requests', to='accounts.department', verbose_name='所属部门'),
        ),
        migrations.AddField(
            model_name='approvalrequest',
            name='expense_type',
            field=models.CharField(blank=True, choices=[('travel', '差旅费'), ('office', '办公用品'), ('meals', '餐饮费'), ('transport', '交通费'), ('communication', '通讯费'), ('equipment', '设备采购'), ('training', '培训费'), ('other_expense', '其他')], max_length=30, null=True, verbose_name='费用类型'),
        ),
        migrations.AddField(
            model_name='approvalrequest',
            name='expense_date',
            field=models.DateField(blank=True, null=True, verbose_name='费用发生日期'),
        ),
        migrations.AddField(
            model_name='approvalrequest',
            name='attachments',
            field=models.JSONField(blank=True, default=list, null=True, verbose_name='附件'),
        ),
        migrations.AlterField(
            model_name='attendancerecord',
            name='device',
            field=models.CharField(blank=True, default='', max_length=255, verbose_name='打卡设备'),
        ),
    ]
