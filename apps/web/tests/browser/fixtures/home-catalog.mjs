// Public, synthetic book data shared by responsive homepage tests and local previews.
export function homeCatalog() {
  const option = (id, label, kind, sortOrder) => ({ id, label, kind, sortOrder, active: true });
  const options = {
    categories: ["绘本", "故事", "科普", "其他"].map((label, i) => option(`category-${i}`, label, "CATEGORY", i)),
    ages: ["0—3 岁", "3—6 岁", "6—9 岁", "9—12 岁", "13 岁以上"].map((label, i) => option(`age-${i}`, label, "AGE", i)),
    conditions: [option("condition-good", "八成新", "CONDITION", 0)],
  };
  const shops = [
    { id: "preview-tangtang", displayName: "糖糖书屋", avatarUrl: null },
    { id: "preview-moon", displayName: "月亮书屋", avatarUrl: null },
  ];
  const books = [];
  function add(title, shop, category, age, count = 1, seriesId = null, available = true) {
    const series = seriesId ? { id: seriesId, name: title, summary: "适合亲子共读，也可以挑选分册单独借阅。" } : null;
    for (let i = 1; i <= count; i++) books.push({
      id: `preview-book-${books.length + 1}`, shopId: shops[shop].id,
      series, seriesOrder: series ? i : null,
      title: series ? `${title}第${i}册` : title, author: "", category, age,
      categoryOptionId: options.categories.find(row => row.label === category).id,
      ageOptionId: options.ages.find(row => row.label === age).id,
      condition: "八成新", conditionOptionId: "condition-good",
      owner: shops[shop].displayName, ownerAvatarUrl: null,
      summary: "本地预览示例图书，用于检查找书、筛选与选书布局。",
      nonChildren: false, coverUrl: null, available, offShelf: false,
      status: available ? "AVAILABLE" : "ON_LOAN", mine: false, editable: false, tone: "mint",
    });
  }
  add("彼得兔故事全集", 0, "绘本", "3—6 岁", 6, "preview-rabbit");
  add("超级飞侠系列图书", 1, "故事", "3—6 岁", 10, "preview-wings");
  add("漫画福尔摩斯：雷盖特之谜", 0, "故事", "9—12 岁");
  add("无处不在的经济学", 0, "科普", "9—12 岁");
  add("聪明宝贝手工大全", 1, "其他", "6—9 岁");
  add("100层房子系列", 1, "绘本", "6—9 岁", 2, "preview-treehouse");
  add("漫画福尔摩斯：爬行人", 0, "故事", "6—9 岁", 1, null, false);
  add("米小圈上学记系列", 1, "故事", "6—9 岁", 4, "preview-rice");
  const family = { id: "preview-viewer", username: "preview", email: "parent@example.test", phone: "", phoneVerified: false, displayName: "预览书屋", avatarUrl: null, children: [] };
  return { options, books, shops, family };
}
