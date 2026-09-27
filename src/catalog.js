// 公共目录索引：条款与措施按编码快速查找，并做基本一致性校验。
export function indexCatalog(catalog) {
  if (!catalog || !Array.isArray(catalog.measures)) {
    throw new Error('公共目录缺少 measures');
  }
  const articles = new Map();
  for (const agreement of catalog.agreements ?? []) {
    for (const article of agreement.articles ?? []) {
      if (articles.has(article.code)) {
        throw new Error(`条款编码重复: ${article.code}`);
      }
      articles.set(article.code, { ...article, agreement: agreement.code });
    }
  }
  const measures = new Map();
  for (const measure of catalog.measures) {
    if (measures.has(measure.code)) {
      throw new Error(`措施编码重复: ${measure.code}`);
    }
    if (!articles.has(measure.article)) {
      throw new Error(`措施 ${measure.code} 引用了不存在的条款 ${measure.article}`);
    }
    measures.set(measure.code, measure);
  }
  return { articles, measures };
}
