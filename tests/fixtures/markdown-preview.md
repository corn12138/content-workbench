# Markdown 预览验收

[跳到中文标题](#中文标题) · [跳到重复标题](#中文标题-1) · [带标题的外链](https://example.com "示例网站")

这是一段中文与 English 混排。**粗体**、*斜体*、~~删除线~~、`inline_code()`，转义星号 \*不应强调\*。

这一行末尾有两个空格。  
这一句应当换行。

## 中文标题

### 三级标题

#### 四级标题

##### 五级标题

###### 六级标题

3. 从三开始
4. 第二项
   - 嵌套无序列表
   - 继续嵌套
     1. 第三层

- [x] 已完成事项
- [ ] 未完成事项

> 引用第一段。
>
> 引用第二段，含 **重点**。
>
> > 嵌套引用。

| 左对齐 | 居中 | 右对齐 | 较长内容 |
| :--- | :---: | ---: | --- |
| **文字** | `x` | 123 | 表格内含管道符 a\|b |
| 第二行 | 中文 | 9999 | long_long_long_long_long_long_long_long_long_long_long_long_long_long |

```typescript
const result = await saveDraft(content);
const text = "<script>只是代码，不执行</script>";
  console.log(text);
```

```unknown-language
unknown language stays readable
  indentation remains intact
```

```mermaid
graph LR
  A[写作] --> B[审核]
  B --> C[发布]
```

行内公式 $E=mc^2$ 与分式 $\frac{a}{b}$。

$$
\int_0^1 x^2\,dx = \frac{1}{3}
$$

<details open>
<summary>安全 HTML 折叠块</summary>
<p>HTML 正文应保留，<strong>粗体</strong>及<br>换行正常。</p>
</details>

<img src="https://example.com/tracker.png" alt="远程图片不会自动加载">

<script>window.__unsafeExecuted = true</script>

## 中文标题

同名标题应获得独立锚点。正文脚注[^note]。

[^note]: 注释正文，包含 [公开资料](https://example.com)，可以返回正文。

---

外链图片应显示明确占位，不产生联网请求：

![远程图片](https://example.com/preview.png "外链图片")

[本地文件](file:///not-a-real-file) 不应打开本机文件。
