# -*- coding: utf-8 -*-
"""聊天主题词云分词工具。

优先使用第三方中文分词库 jieba；服务器未安装时自动回退到
「英文单词 + 中文重叠 n-gram」的轻量方案，保证功能可用。
"""
import re
from collections import Counter

try:
    import jieba
    try:
        # 关闭 jieba 首次加载词典时的 INFO 日志（logging.CRITICAL=50，取 60 更安静）
        jieba.setLogLevel(60)
    except Exception:
        pass
    JIEBA_AVAILABLE = True
except ImportError:  # pragma: no cover - 依赖缺失时的降级路径
    jieba = None
    JIEBA_AVAILABLE = False


STOPWORDS = {
    '我们', '你们', '他们', '她们', '它们', '这个', '那个', '这些', '那些', '什么', '怎么',
    '怎样', '为何', '为什么', '可以', '没有', '不是', '就是', '还是', '因为', '所以', '但是',
    '如果', '现在', '今天', '明天', '昨天', '好的', '收到', '谢谢', '麻烦', '一下', '已经',
    '需要', '进行', '然后', '时候', '感觉', '知道', '觉得', '可能', '应该', '事情', '问题',
    '东西', '地方', '时间', '大家', '自己', '多少', '还有', '并且', '而且', '或者', '以及',
    '对于', '关于', '通过', '根据', '由于', '虽然', '不过', '这样', '那样', '这里', '那里',
    '一起', '一直', '一点', '一些', '不会', '不能', '不用', '不要', '没关系', '没问题',
    '哈哈', '呵呵', '嗯嗯', '好的好的', '行吧', '好吧', '是的', '对的', '真的', '有点',
    '比较', '非常', '特别', '确实', '其实', '另外', '主要', '直接', '马上', '刚才', '刚刚',
    '的话', '来说', '之后', '之前', '以后', '以前', '是否', '里面', '上面', '下面', '方面',
    '一个', '两个', '这边', '那边', '这个月', '那个月', '有没有', '是不是', '能不能',
}

EN_STOPWORDS = {
    'the', 'and', 'for', 'you', 'are', 'with', 'this', 'that', 'have', 'not', 'but', 'can',
    'will', 'was', 'were', 'from', 'they', 'them', 'your', 'our', 'its', 'what', 'when',
    'where', 'which', 'who', 'how', 'why', 'all', 'any', 'one', 'two', 'get', 'got', 'use',
    'http', 'https', 'www', 'com', 'cn', 'ok', 'okay', 'yes', 'hi', 'hello', 'test', 'null',
    'none', 'true', 'false', 'is', 'of', 'to', 'in', 'on', 'at', 'be', 'it', 'as', 'we',
}

_EN_WORD_RE = re.compile(r'[A-Za-z][A-Za-z0-9_+#.-]{0,}')
_CN_RUN_RE = re.compile(r'[一-龥]{2,}')
_URL_RE = re.compile(r'https?://\S+')
_MENTION_RE = re.compile(r'@\S+')
_VALID_TOKEN_RE = re.compile(r'[一-龥A-Za-z0-9+#.\-_]+')


def _normalize_text(text):
    text = (text or '').strip()
    if not text:
        return ''
    text = _URL_RE.sub(' ', text)
    text = _MENTION_RE.sub(' ', text)
    return text


def _clean_token(word):
    word = (word or '').strip().strip('.,!?;:\'"()[]{}<>，。！？；：、“”‘’（）【】《》')
    if not word:
        return ''
    if not _VALID_TOKEN_RE.fullmatch(word):
        return ''
    # 单字（中/英文）与纯数字噪声太大，直接丢弃
    if len(word) == 1:
        return ''
    if word.isdigit():
        return ''
    if len(word) > 12:
        return ''
    return word


def _jieba_tokens(text):
    for raw in jieba.cut(text, cut_all=False):
        word = _clean_token(raw)
        if not word:
            continue
        lower = word.lower()
        if word in STOPWORDS or lower in EN_STOPWORDS:
            continue
        # 纯英文统一小写，中文保持原样
        yield lower if word.isascii() else word


def _ngram_tokens(text):
    """未安装 jieba 时的降级分词：英文单词 + 中文重叠 n-gram。"""
    for m in _EN_WORD_RE.finditer(text):
        word = _clean_token(m.group(0))
        if not word:
            continue
        lower = word.lower()
        if len(lower) >= 2 and lower not in EN_STOPWORDS:
            yield lower

    for run in _CN_RUN_RE.findall(text):
        run = run[:12]
        n = len(run)
        if n <= 4:
            if run not in STOPWORDS:
                yield run
            continue
        for size in (2, 3):
            for i in range(0, n - size + 1):
                word = run[i:i + size]
                if word not in STOPWORDS:
                    yield word
        for i in range(0, n - 4 + 1, 3):
            word = run[i:i + 4]
            if word not in STOPWORDS:
                yield word


def extract_tokens(content):
    """从一条聊天文本中提取候选词。"""
    text = _normalize_text(content)
    if not text:
        return
    tokens = _jieba_tokens(text) if JIEBA_AVAILABLE else _ngram_tokens(text)
    for token in tokens:
        yield token


def build_word_cloud(contents, top_n=120, min_count=2):
    """把若干条消息文本聚合成词云数据，返回 (words, total_messages)。"""
    counter = Counter()
    total = 0
    for content in contents:
        total += 1
        for token in extract_tokens(content):
            counter[token] += 1

    words = [(w, c) for w, c in counter.items() if c >= min_count]
    if len(words) < 12:
        words = list(counter.items())
    words.sort(key=lambda item: item[1], reverse=True)
    return [{'name': w, 'value': c} for w, c in words[:top_n]], total
