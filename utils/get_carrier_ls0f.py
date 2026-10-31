# -*- coding: utf-8 -*-
# @File   :get_carrier_ls0f.py
# @Time   :2026/10/30 09:42
# @Author :admin

import re
import zipfile
from pathlib import Path

from openpyxl import load_workbook, Workbook
from phone import Phone

p = Phone()

# XML 1.0 不允许的控制字符（保留 \t \n \r）
ILLEGAL_XML = re.compile(r"[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]")


# ---------- 1) 修复 xlsx 内部 XML ----------
def repair_xlsx(src: str, dst: str) -> None:
    """把 xlsx 当作 zip 拆开，清洗每个 xml/rels 里的非法控制字符后重新打包"""
    src, dst = Path(src), Path(dst)
    with zipfile.ZipFile(src, "r") as zin, \
         zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename.endswith((".xml", ".rels")):
                text = data.decode("utf-8", errors="ignore")
                data = ILLEGAL_XML.sub("", text).encode("utf-8")
            zout.writestr(item, data)


# ---------- 2) 手机号规整 ----------
def normalize_phone(v) -> str:
    """把 Excel 单元格里的手机号统一成 11 位纯数字字符串"""
    if v is None:
        return ""
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    s = str(v).strip()
    s = re.sub(r"[\s\-]", "", s)          # 去空格、横线
    if s.endswith(".0"):
        s = s[:-2]
    if "E" in s.upper():                   # 科学计数法 1.8668181234E10
        try:
            s = str(int(float(s)))
        except Exception:
            pass
    return s


# ---------- 3) 运营商解析 ----------
def parse_phone(phone_str: str) -> dict:
    base = {
        "province": "", "city": "", "zip_code": "",
        "area_code": "", "phone_type": "空号", "parse_status": "空号",
    }
    if not phone_str:
        return base
    if len(phone_str) != 11 or not phone_str.isdigit():
        base.update(phone_type="格式错误", parse_status="格式错误")
        print(f'==> phone_str: {phone_str} 格式错误')
        return base

    info = p.find(phone_str[:7])
    if not info:
        base.update(phone_type="未知", parse_status="号段未收录")
        print(f'==> phone_str: {phone_str} 号段未收录')
        return base

    base.update({
        "province":   info.get("province", ""),
        "city":       info.get("city", ""),
        "zip_code":   info.get("zip_code", ""),
        "area_code":  info.get("area_code", ""),
        "phone_type": info.get("phone_type", "未知"),
        "parse_status": "成功",
    })
    return base


# ---------- 4) 主流程 ----------
def main(input_path: str, output_path: str):
    # 4.1 先修复，规避 ExpatError
    fixed_path = str(Path(input_path).with_name(
        Path(input_path).stem + "_fixed.xlsx"))
    try:
        # repair_xlsx(input_path, fixed_path)
        src = fixed_path
        print(f"[repair] 清洗非法 XML 字符 -> {fixed_path}")
    except Exception as e:
        print(f"[repair] 跳过（{e}），直接读原文件")
        src = input_path

    # 4.2 只读模式打开，流式迭代行
    wb = load_workbook(src, read_only=True, data_only=True)
    ws = wb[wb.sheetnames[0]]
    rows = ws.iter_rows(values_only=True)

    # 4.3 定位 phone / name 列
    header = next(rows)
    header = [str(h).strip().lower() if h is not None else "" for h in header]
    phone_idx = header.index("phone") if "phone" in header else 0
    name_idx  = header.index("name")  if "name"  in header else 1
    print(f"[read ] 表头: {header} | phone列={phone_idx}, name列={name_idx}")

    # 4.4 write_only 写出，边读边写，内存 O(1)
    wb_out = Workbook(write_only=True)
    ws_out = wb_out.create_sheet("result")
    ws_out.append(["手机号", "姓名", "省份", "城市",
                   "邮编", "区号", "运营商", "解析状态"])

    stats: dict[str, int] = {}
    count = 0
    for row in rows:
        if row is None:
            continue
        phone_raw = row[phone_idx] if phone_idx < len(row) else None
        name_raw  = row[name_idx]  if name_idx  < len(row) else None

        phone_str = normalize_phone(phone_raw)
        info = parse_phone(phone_str)
        print(f'phone_raw: {phone_raw} -- phone_str: {phone_str} -- info: {info}')

        ws_out.append([
            phone_str,
            "" if name_raw is None else str(name_raw),
            info["province"], info["city"], info["zip_code"],
            info["area_code"], info["phone_type"], info["parse_status"],
        ])
        stats[info["parse_status"]] = stats.get(info["parse_status"], 0) + 1
        count += 1

    wb.close()
    wb_out.save(output_path)
    wb_out.close()

    print(f"[done ] 处理 {count} 行 -> {output_path}")
    for k, v in stats.items():
        print(f"    {k}: {v}")



'''
{'province': '浙江', 'city': '金华', 'zip_code': '321000', 'area_code': '0579', 'phone_type': '移动', 'parse_status': '成功'}
{'province': '浙江', 'city': '杭州', 'zip_code': '310000', 'area_code': '0571', 'phone_type': '联通', 'parse_status': '成功'}

'''

if __name__ == "__main__":
    input_path = r"G:\Users\zy\Documents\document\phone.xlsx"
    output_path = r"G:\Users\zy\Documents\document\phone_with_carrier.xlsx"
    main(input_path, output_path)
    # r = parse_phone('15924283804')
    # r = parse_phone('18668183817')
    # print(f'result: {r}')