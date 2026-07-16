# -*- coding: utf-8 -*-
# @File   :reverse_geocoding_to_city.py
# @Time   :2026/7/16 10:22
# @Author :admin

from loguru import logger
import requests

def bigdatacloud_geocoding(latitude, longitude, key, language='zh'):
    url = f'https://api-bdc.net/data/reverse-geocode?latitude={latitude}&longitude={longitude}&localityLanguage={language}&key={key}'
    response = requests.get(url, timeout=8, verify=False, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.36'})
    if response.status_code == 200:
        data = response.json()
        return data
    else:
        return None



def baidu_geocoding(latitude, longitude, ak, coordtype='gcj02ll'):
    """
    百度反向地理编码获取位置接口
    :param latitude:
    :param longitude:
    :param ak:
    :param coordtype:
    :return:
    """
    # 坐标的类型，目前支持的坐标类型包括：bd09ll（百度经纬度坐标）、bd09mc（百度米制坐标）、gcj02ll（国测局经纬度坐标，仅限中国）、wgs84ll（ GPS经纬度）

    # extensions_poi=0，不召回pois数据。
    # extensions_poi=1，返回pois数据（默认显示周边1000米内的poi），并返回sematic_description语义化数据和formatted_address_poi 结构化地址（包含POI信息）

    # sort_strategy 配合entire_poi使用，可选择distance距离、rank重要性、default 综合排序三个参数进行对POI结果 （排序影响formatted_address_poi的结果）

    # entire_poi 设置该参数可召回更多POI，优化 formatted_address_poi的结果， 与sort_strategy参数配合使用效果更佳

    # 接口地址
    url = "https://api.map.baidu.com/reverse_geocoding/v3/"
    params = {
        "ak": ak,
        "output": "json",
        "coordtype": f"{coordtype}",
        "extensions_poi": "",
        "sort_strategy": "distance",
        "entire_poi": "",
        "location": f"{latitude},{longitude}",

    }
    try:
        response = requests.get(url=url, params=params)
        logger.info(f"url: {response.url}")
        if response.status_code == 200:
            data = response.json()
            return data
        else:
            return None
    except Exception as e:
        logger.error(f"百度逆向地理编码接口异常: {e}")
        return None


# if __name__ == '__main__':
#     latitude = 29.311018058751003
#     longitude = 120.02772703724952
#
#     latitude = 29.311925339307138
#     longitude = 120.00695937816454
#
#     latitude = 29.311938574749444
#     longitude = 120.00696074458808
#
#
#     latitude = 29.311922284021353
#     longitude = 120.00695702100275
#
#     ak = 'Qaq34wbYDjV1gTRbPi7POx5OxaiHfmT1'
#     key = 'your_bigdatacloud_key'
#     result = baidu_geocoding(latitude, longitude, ak)
#     print(result)