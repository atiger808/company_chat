# -*- coding: utf-8 -*-
# @File   :wps_image_converter.py
# @Time   :2026/9/4 17:39
# @Author :admin

import zipfile
import re
import os
import shutil
import openpyxl
from openpyxl.drawing.image import Image
import xml.etree.ElementTree as ET


def wps_image_converter(input_xlsx, output_xlsx):
    # 创建一个临时文件夹用来做图片中转缓存
    temp_dir = "temp_wps_images"
    if not os.path.exists(temp_dir):
        os.makedirs(temp_dir)

    print(f"正在加载表格: {input_xlsx} ...")

    try:
        # 必须开启 data_only=False 以读取公式
        wb = openpyxl.load_workbook(input_xlsx, data_only=False)
    except Exception as e:
        print(f"打开 Excel 失败: {e}")
        return

    # --- 第一步：解析全局图片映射 (这部分逻辑与 Sheet 无关，只需解析一次) ---
    id_to_target = {}
    try:
        with zipfile.ZipFile(input_xlsx, 'r') as z:
            # 检查是否存在 WPS 图片容器文件
            if 'xl/cellimages.xml' not in z.namelist():
                print("未在文件中找到 WPS 嵌入图片容器，请确认文件是否包含嵌入图片。")
                return

            cellimages_bytes = z.read('xl/cellimages.xml')
            rels_bytes = z.read('xl/_rels/cellimages.xml.rels')

            # 解析 rId -> 物理路径
            rId_to_target = {}
            rels_root = ET.fromstring(rels_bytes)
            for elem in rels_root.iter():
                if elem.tag.endswith('Relationship'):
                    rid = elem.attrib.get('Id')
                    target = elem.attrib.get('Target')
                    if rid and target:
                        rId_to_target[rid] = target

            # 解析 图片ID -> rId
            cellimages_root = ET.fromstring(cellimages_bytes)
            for child in cellimages_root:
                name, embed = None, None
                for sub in child.iter():
                    for k, v in sub.attrib.items():
                        if k.endswith('name') and str(v).startswith('ID_'):
                            name = v
                        if k.endswith('embed'):
                            embed = v
                if name and embed and embed in rId_to_target:
                    id_to_target[name] = rId_to_target[embed]

            # --- 第二步：遍历每一个工作表进行处理 ---
            total_success_count = 0

            for sheet in wb.worksheets:
                print(f"\n正在处理工作表: [{sheet.title}]")
                sheet_success_count = 0

                # 查找当前表中包含 DISPIMG 的单元格
                cell_to_id = {}
                for row in sheet.iter_rows():
                    for cell in row:
                        cell_val = str(cell.value)
                        if "DISPIMG" in cell_val:
                            match = re.search(r'DISPIMG\s*\(\s*"([^"]+)"', cell_val)
                            if match:
                                cell_to_id[cell.coordinate] = match.group(1)

                if not cell_to_id:
                    print(f"  > 该工作表未检测到嵌入图片，跳过。")
                    continue

                # 插入图片
                for coord, img_id in cell_to_id.items():
                    target_path = id_to_target.get(img_id)
                    if not target_path:
                        continue

                    # 路径格式化
                    if target_path.startswith('/'):
                        full_target_path = target_path[1:]
                    elif target_path.startswith('xl/'):
                        full_target_path = target_path
                    else:
                        full_target_path = f"xl/{target_path}"

                    # 提取并插入
                    ext = full_target_path.split('.')[-1]
                    # 为了防止多张表有相同坐标导致文件名冲突，加上 sheet.title
                    safe_title = re.sub(r'[\\/*?:\[\]]', '_', sheet.title)
                    temp_img_path = os.path.join(temp_dir, f"{safe_title}_{coord}.{ext}")

                    try:
                        with z.open(full_target_path) as source, open(temp_img_path, 'wb') as target_file:
                            shutil.copyfileobj(source, target_file)

                        img = Image(temp_img_path)
                        img.width, img.height = 90, 90  # 默认大小
                        sheet.add_image(img, coord)
                        sheet[coord].value = ""  # 清空原公式

                        sheet_success_count += 1
                        total_success_count += 1
                    except Exception as e:
                        print(f"  > [失败] 单元格 {coord} 报错: {e}")

                print(f"  > 完成！该表修复了 {sheet_success_count} 张图片。")

    except Exception as e:
        print(f"解析底层数据时发生致命错误: {e}")
        return

    # 保存文件
    print(f"\n正在保存到: {output_xlsx} ...")
    wb.save(output_xlsx)
    shutil.rmtree(temp_dir, ignore_errors=True)

    print(f"==================================================")
    print(f"全部任务完成！累计修复 {total_success_count} 张图片。")



