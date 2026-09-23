import 'package:flutter/material.dart';

const _ink = Color(0xFF4E342E);
const _muted = Color(0xFF765F54);
const _peach = Color(0xFFFFE2D5);
const _mint = Color(0xFFE4F3E8);
const _lavender = Color(0xFFE7EDFF);

class PrototypeBanner extends StatelessWidget {
  const PrototypeBanner({super.key});

  @override
  Widget build(BuildContext context) => Semantics(
    label: '界面演示，图书信息为虚构示例，尚未连接真实借阅服务',
    child: Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: const Color(0xFFFFF1C7),
        borderRadius: BorderRadius.circular(14),
      ),
      child: const Text(
        '界面演示 · 图书为虚构示例，暂不能借阅',
        style: TextStyle(fontWeight: FontWeight.w700),
      ),
    ),
  );
}

class DemoBook {
  const DemoBook(
    this.title,
    this.author,
    this.age,
    this.category,
    this.icon,
    this.color,
  );

  final String title;
  final String author;
  final String age;
  final String category;
  final IconData icon;
  final Color color;
}

const _books = [
  DemoBook('森林里的邮差', '待确认', '3—6 岁', '绘本', Icons.local_florist, _mint),
  DemoBook('星星去哪儿了', '待确认', '6—9 岁', '科普', Icons.star_rounded, _lavender),
  DemoBook('小熊的星期天', '待确认', '3—6 岁', '故事', Icons.pets_rounded, _peach),
];

class DemoBookStrip extends StatelessWidget {
  const DemoBookStrip({super.key});

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      const Text(
        '看看书屋里有什么',
        style: TextStyle(fontSize: 21, fontWeight: FontWeight.w800),
      ),
      const SizedBox(height: 10),
      ..._books
          .take(2)
          .map(
            (book) => Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: _BookTile(book: book),
            ),
          ),
    ],
  );
}

class _BookTile extends StatelessWidget {
  const _BookTile({required this.book});
  final DemoBook book;

  @override
  Widget build(BuildContext context) => Card(
    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
    child: InkWell(
      borderRadius: BorderRadius.circular(20),
      onTap: () => Navigator.of(context).push(
        MaterialPageRoute<void>(builder: (_) => BookDemoDetailPage(book: book)),
      ),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          children: [
            Container(
              width: 74,
              height: 94,
              decoration: BoxDecoration(
                color: book.color,
                borderRadius: BorderRadius.circular(12),
              ),
              child: Icon(book.icon, size: 38, color: _ink),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    book.title,
                    style: const TextStyle(
                      fontSize: 17,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 5),
                  Text(
                    '${book.category} · ${book.age}',
                    style: const TextStyle(color: _muted),
                  ),
                  const SizedBox(height: 7),
                  const Text(
                    '演示书籍 · 尚未开放借阅',
                    style: TextStyle(fontSize: 12, color: _muted),
                  ),
                ],
              ),
            ),
            const Icon(Icons.chevron_right_rounded),
          ],
        ),
      ),
    ),
  );
}

class SearchDemoPage extends StatefulWidget {
  const SearchDemoPage({super.key});
  @override
  State<SearchDemoPage> createState() => _SearchDemoPageState();
}

class _SearchDemoPageState extends State<SearchDemoPage> {
  String query = '';
  String category = '全部';
  String age = '全部';

  @override
  Widget build(BuildContext context) {
    final results = _books
        .where(
          (book) =>
              (query.isEmpty || book.title.contains(query)) &&
              (category == '全部' || book.category == category) &&
              (age == '全部' || book.age == age),
        )
        .toList();
    return Scaffold(
      appBar: AppBar(title: const Text('找一本好书')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            const PrototypeBanner(),
            const SizedBox(height: 18),
            TextField(
              decoration: const InputDecoration(
                prefixIcon: Icon(Icons.search_rounded),
                hintText: '搜索书名',
                border: OutlineInputBorder(),
              ),
              onChanged: (value) => setState(() => query = value.trim()),
            ),
            const SizedBox(height: 14),
            const Text('分类', style: TextStyle(fontWeight: FontWeight.w700)),
            _chips(
              ['全部', '绘本', '故事', '科普'],
              category,
              (value) => setState(() => category = value),
            ),
            const Text('适读年龄', style: TextStyle(fontWeight: FontWeight.w700)),
            _chips(
              ['全部', '3—6 岁', '6—9 岁'],
              age,
              (value) => setState(() => age = value),
            ),
            const SizedBox(height: 12),
            Text(
              '找到 ${results.length} 本演示书籍',
              style: const TextStyle(color: _muted),
            ),
            const SizedBox(height: 10),
            if (results.isEmpty)
              const _EmptyCard(
                icon: Icons.menu_book_outlined,
                title: '没有找到匹配的书',
                detail: '试试换个书名、分类或年龄段。',
              ),
            ...results.map(
              (book) => Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: _BookTile(book: book),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _chips(
    List<String> values,
    String selected,
    ValueChanged<String> onTap,
  ) => Wrap(
    spacing: 8,
    children: values
        .map(
          (value) => ChoiceChip(
            label: Text(value),
            selected: value == selected,
            onSelected: (_) => onTap(value),
          ),
        )
        .toList(),
  );
}

class BookDemoDetailPage extends StatelessWidget {
  const BookDemoDetailPage({super.key, required this.book});
  final DemoBook book;

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('图书详情')),
    body: SafeArea(
      child: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          const PrototypeBanner(),
          const SizedBox(height: 18),
          Container(
            height: 190,
            decoration: BoxDecoration(
              color: book.color,
              borderRadius: BorderRadius.circular(24),
            ),
            child: Icon(book.icon, size: 86, color: _ink),
          ),
          const SizedBox(height: 20),
          Text(
            book.title,
            style: const TextStyle(fontSize: 27, fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 6),
          Text('作者：${book.author}', style: const TextStyle(color: _muted)),
          const SizedBox(height: 16),
          Wrap(
            spacing: 8,
            children: [
              Chip(label: Text(book.category)),
              Chip(label: Text(book.age)),
              const Chip(label: Text('新旧程度待确认')),
            ],
          ),
          const SizedBox(height: 18),
          const _InfoCard(
            icon: Icons.auto_awesome_outlined,
            title: '内容简介待确认',
            detail: '真实发布时由家长核对封面、书名、作者和 AI 建议后填写；无法确定的信息会标注“待确认”。',
          ),
          const SizedBox(height: 12),
          const _InfoCard(
            icon: Icons.shield_outlined,
            title: '家长约定交接',
            detail: '申请和交接都由家长确认。联系方式与约定地点仅借阅双方可见。',
          ),
          const SizedBox(height: 18),
          const FilledButton(onPressed: null, child: Text('申请借阅 · 第 7 章开放')),
        ],
      ),
    ),
  );
}

class PublishDemoPage extends StatelessWidget {
  const PublishDemoPage({super.key});

  @override
  Widget build(BuildContext context) => SafeArea(
    child: ListView(
      padding: const EdgeInsets.all(20),
      children: [
        const _PageHeading('发布旧书', '拍张封面，家长核对后再分享'),
        const PrototypeBanner(),
        const SizedBox(height: 18),
        Container(
          height: 160,
          decoration: BoxDecoration(
            color: _mint,
            borderRadius: BorderRadius.circular(24),
          ),
          child: const Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(Icons.add_a_photo_outlined, size: 44),
              SizedBox(height: 8),
              Text('封面照片位置', style: TextStyle(fontWeight: FontWeight.w700)),
              Text('相机与相册将在第 6 章接入'),
            ],
          ),
        ),
        const SizedBox(height: 18),
        const _InfoCard(
          icon: Icons.tips_and_updates_outlined,
          title: 'AI 建议需要家长确认',
          detail: '识别不清的信息显示“待确认”；简介和适读年龄只是建议，不会自动发布。',
        ),
        const SizedBox(height: 18),
        const _FieldPreview('书名', '待确认'),
        const _FieldPreview('作者', '待确认'),
        const _FieldPreview('分类与适读年龄', '待确认'),
        const _FieldPreview('新旧程度', '由书主补充'),
        const SizedBox(height: 10),
        const FilledButton(onPressed: null, child: Text('核对并发布 · 第 6 章开放')),
      ],
    ),
  );
}

class InboxDemoPage extends StatelessWidget {
  const InboxDemoPage({super.key});

  @override
  Widget build(BuildContext context) => SafeArea(
    child: ListView(
      padding: const EdgeInsets.all(20),
      children: [
        const _PageHeading('消息与待办', '借还进度，一眼看清'),
        const PrototypeBanner(),
        const SizedBox(height: 16),
        const _EmptyCard(
          icon: Icons.mark_email_read_outlined,
          title: '暂时没有新消息',
          detail: '真实借阅开始后，申请、交接、到期和归还提醒会出现在这里。',
        ),
        const SizedBox(height: 18),
        const Text(
          '借还会经历这些步骤',
          style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800),
        ),
        const SizedBox(height: 12),
        ...[
          '申请借阅',
          '书主家长同意',
          '家长约定交接',
          '双方确认借出',
          '到期提醒或续借',
          '双方确认归还',
        ].asMap().entries.map(
          (entry) => ListTile(
            leading: CircleAvatar(
              backgroundColor: _lavender,
              child: Text('${entry.key + 1}'),
            ),
            title: Text(entry.value),
            subtitle: const Text('演示流程 · 尚无真实订单'),
          ),
        ),
        const _InfoCard(
          icon: Icons.report_outlined,
          title: '遇到问题？',
          detail: '每笔真实借阅将提供举报入口，由管理员查看并处理。',
        ),
      ],
    ),
  );
}

class MyLibraryDemoPage extends StatelessWidget {
  const MyLibraryDemoPage({super.key});

  @override
  Widget build(BuildContext context) => SafeArea(
    child: ListView(
      padding: const EdgeInsets.all(20),
      children: [
        const _PageHeading('我的书屋', '一家人的阅读小角落'),
        const PrototypeBanner(),
        const SizedBox(height: 18),
        const _InfoCard(
          icon: Icons.family_restroom_rounded,
          title: '家庭资料',
          detail: '未来由家长管理孩子昵称、年龄段和阅读偏好。真实姓名与家庭住址不会公开。',
        ),
        const SizedBox(height: 18),
        const _SectionTitle('我的藏书'),
        const _EmptyCard(
          icon: Icons.library_books_outlined,
          title: '还没有发布图书',
          detail: '拍张旧书封面，核对信息后分享给其他家庭。',
        ),
        const SizedBox(height: 18),
        const _SectionTitle('借入 · 借出'),
        const _EmptyCard(
          icon: Icons.swap_horiz_rounded,
          title: '还没有借阅记录',
          detail: '申请、交接和归还的记录会保存在这里。',
        ),
        const SizedBox(height: 18),
        const _InfoCard(
          icon: Icons.privacy_tip_outlined,
          title: '家庭隐私优先',
          detail: '公开页面只展示必要的书籍信息；交接约定仅借阅双方家长可见。',
        ),
      ],
    ),
  );
}

class _PageHeading extends StatelessWidget {
  const _PageHeading(this.title, this.subtitle);
  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 18),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          title,
          style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w800),
        ),
        const SizedBox(height: 4),
        Text(subtitle, style: const TextStyle(color: _muted)),
      ],
    ),
  );
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle(this.title);
  final String title;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 10),
    child: Text(
      title,
      style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800),
    ),
  );
}

class _FieldPreview extends StatelessWidget {
  const _FieldPreview(this.label, this.value);
  final String label;
  final String value;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 10),
    child: InputDecorator(
      decoration: InputDecoration(
        labelText: label,
        border: const OutlineInputBorder(),
      ),
      child: Text(value),
    ),
  );
}

class _InfoCard extends StatelessWidget {
  const _InfoCard({
    required this.icon,
    required this.title,
    required this.detail,
  });
  final IconData icon;
  final String title;
  final String detail;
  @override
  Widget build(BuildContext context) => Card(
    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
    child: Padding(
      padding: const EdgeInsets.all(16),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          CircleAvatar(
            backgroundColor: const Color(0xFFFFF1C7),
            child: Icon(icon, color: _ink),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(fontWeight: FontWeight.w800),
                ),
                const SizedBox(height: 5),
                Text(
                  detail,
                  style: const TextStyle(color: _muted, height: 1.35),
                ),
              ],
            ),
          ),
        ],
      ),
    ),
  );
}

class _EmptyCard extends StatelessWidget {
  const _EmptyCard({
    required this.icon,
    required this.title,
    required this.detail,
  });
  final IconData icon;
  final String title;
  final String detail;
  @override
  Widget build(BuildContext context) => Container(
    width: double.infinity,
    padding: const EdgeInsets.all(22),
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(22),
    ),
    child: Column(
      children: [
        Icon(icon, size: 38, color: _muted),
        const SizedBox(height: 8),
        Text(title, style: const TextStyle(fontWeight: FontWeight.w800)),
        const SizedBox(height: 5),
        Text(
          detail,
          textAlign: TextAlign.center,
          style: const TextStyle(color: _muted),
        ),
      ],
    ),
  );
}
