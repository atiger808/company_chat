# -*- coding: utf-8 -*-
"""坐标系转换与距离计算（纯数学，不依赖任何地图 API / 网络）。

用途：考勤打卡范围。
- 浏览器 navigator.geolocation 给出的是 WGS84（GPS），打卡记录存 WGS84（latitude/longitude）；
- 百度地图 JS API 给出/需要的是 BD09；
- 因此：前端把地图点击得到的 BD09 原样交给后端，后端统一转成 WGS84 存储；
  展示时后端再把 WGS84 转回 BD09 给地图画圆。坐标换算只在这一个文件里，便于校验。

数值精度：BD09/GCJ02 偏移量在几十~几百米量级，本文件用于「是否在半径内」的判定，
对 GPS 自身误差（常见 10~50 米）而言精度足够。
"""
import math

# 长半轴、扁率（GCJ02 加密算法所用 WGS84 椭球参数）
_A = 6378245.0
_EE = 0.00669342162296594323

# BD09 相对 GCJ02 的固定变换参数（百度公开算法）
_X_PI = math.pi * 3000.0 / 180.0


def _out_of_china(lng, lat):
    """粗略判断是否在中国境外：境外不做偏移（偏移算法只在中国有效）"""
    if not (72.004 <= lng <= 137.8347 and 0.8293 <= lat <= 55.8271):
        return True
    return False


def _transform_lat(lng, lat):
    ret = -100.0 + 2.0 * lng + 3.0 * lat + 0.2 * lat * lat + 0.1 * lng * lat + 0.2 * math.sqrt(abs(lng))
    ret += (20.0 * math.sin(6.0 * lng * math.pi) + 20.0 * math.sin(2.0 * lng * math.pi)) * 2.0 / 3.0
    ret += (20.0 * math.sin(lat * math.pi) + 40.0 * math.sin(lat / 3.0 * math.pi)) * 2.0 / 3.0
    ret += (160.0 * math.sin(lat / 12.0 * math.pi) + 320 * math.sin(lat * math.pi / 30.0)) * 2.0 / 3.0
    return ret


def _transform_lng(lng, lat):
    ret = 300.0 + lng + 2.0 * lat + 0.1 * lng * lng + 0.1 * lng * lat + 0.1 * math.sqrt(abs(lng))
    ret += (20.0 * math.sin(6.0 * lng * math.pi) + 20.0 * math.sin(2.0 * lng * math.pi)) * 2.0 / 3.0
    ret += (20.0 * math.sin(lng * math.pi) + 40.0 * math.sin(lng / 3.0 * math.pi)) * 2.0 / 3.0
    ret += (150.0 * math.sin(lng / 12.0 * math.pi) + 300.0 * math.sin(lng / 30.0 * math.pi)) * 2.0 / 3.0
    return ret


def wgs84_to_gcj02(lng, lat):
    """WGS84 → GCJ02（火星坐标）"""
    if _out_of_china(lng, lat):
        return lng, lat
    dlat = _transform_lat(lng - 105.0, lat - 35.0)
    dlng = _transform_lng(lng - 105.0, lat - 35.0)
    rad_lat = lat / 180.0 * math.pi
    magic = math.sin(rad_lat)
    magic = 1 - _EE * magic * magic
    sqrt_magic = math.sqrt(magic)
    dlat = (dlat * 180.0) / ((_A * (1 - _EE)) / (magic * sqrt_magic) * math.pi)
    dlng = (dlng * 180.0) / (_A / sqrt_magic * math.cos(rad_lat) * math.pi)
    return lng + dlng, lat + dlat


def gcj02_to_wgs84(lng, lat):
    """GCJ02 → WGS84（用一次反解近似，误差小于 1 米，足够考勤判距使用）"""
    if _out_of_china(lng, lat):
        return lng, lat
    glng, glat = wgs84_to_gcj02(lng, lat)
    return lng * 2 - glng, lat * 2 - glat


def gcj02_to_bd09(lng, lat):
    """GCJ02 → BD09（百度）"""
    z = math.sqrt(lng * lng + lat * lat) + 0.00002 * math.sin(lat * _X_PI)
    theta = math.atan2(lat, lng) + 0.000003 * math.cos(lng * _X_PI)
    return z * math.cos(theta) + 0.0065, z * math.sin(theta) + 0.006


def bd09_to_gcj02(lng, lat):
    """BD09（百度） → GCJ02"""
    x, y = lng - 0.0065, lat - 0.006
    z = math.sqrt(x * x + y * y) - 0.00002 * math.sin(y * _X_PI)
    theta = math.atan2(y, x) - 0.000003 * math.cos(x * _X_PI)
    return z * math.cos(theta), z * math.sin(theta)


def wgs84_to_bd09(lng, lat):
    """WGS84 → BD09（百度地图展示用）"""
    return gcj02_to_bd09(*wgs84_to_gcj02(lng, lat))


def bd09_to_wgs84(lng, lat):
    """BD09（百度地图点击/取值） → WGS84（存储与判距用）"""
    return gcj02_to_wgs84(*bd09_to_gcj02(lng, lat))


def haversine_m(lat1, lng1, lat2, lng2):
    """两点球面距离（米），入参顺序为 (纬度, 经度)"""
    try:
        lat1, lng1, lat2, lng2 = float(lat1), float(lng1), float(lat2), float(lng2)
    except (TypeError, ValueError):
        return None
    r = 6371008.8  # 地球平均半径（米）
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(a)))


def distance_to_ranges_m(lat, lng, ranges):
    """点到一组圆形范围的最小距离（米）。返回 (距离, 命中的范围名或 None)。
    范围项形如 {'name': '总部', 'lat': .., 'lng': .., 'radius': 300}（WGS84）。
    有任何一个范围命中（距离 <= 半径）时命中名即为该范围名。
    """
    best, hit = None, None
    for r in ranges or []:
        if not isinstance(r, dict):
            continue
        try:
            rlat, rlng = float(r.get('lat')), float(r.get('lng'))
            radius = float(r.get('radius') or 0)
        except (TypeError, ValueError):
            continue
        d = haversine_m(lat, lng, rlat, rlng)
        if d is None:
            continue
        if d <= radius and hit is None:
            hit = r.get('name') or '打卡点'
        if best is None or d < best:
            best = d
    return best, hit
