---
title: 欢迎来到我的博客
date: 2026-10-28
excerpt: 这是一篇示例文章，展示博客支持的 Markdown 功能。
tags:
  - 示例
  - Markdown
---

## 标题、段落与格式

这是一段普通文字。你可以写 **加粗**、*斜体*、~~删除线~~ 和 `行内代码`。

## 列表

无序列表：
- 项目一
- 项目二
- 项目三

有序列表：
1. 第一步
2. 第二步
3. 第三步

## 代码块

```python
def hello_world():
    print("Hello, World!")
    return True
```

```bash
# 启动服务
npm run dev
```

## 引用

> 这是一段引用文字。
> 可以有多行。

## 表格

| 指标 | 2024年 | 2025年 | 同比增速 |
|------|--------|--------|---------|
| 营业收入 | 3620亿 | 4237亿 | +17.04% |
| 净利润 | 507亿 | 722亿 | +42.28% |
| 毛利率 | 24.44% | 26.27% | +1.83pp |

## 图片

在 Markdown 中插入图片：

```
![描述文字](/images/your-image.png)
```

将图片放到 `/root/blog/content/images/` 目录，然后执行：

```bash
ln -sf /root/blog/content/images/* /root/blog/frontend/public/images/
```

## 分割线

---

以上就是这个博客支持的所有 Markdown 功能。把你的 `.md` 文件放到 `/root/blog/content/posts/` 目录，刷新页面即可看到新文章。
