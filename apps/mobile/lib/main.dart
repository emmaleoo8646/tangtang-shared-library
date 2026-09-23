import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';

const apiBaseUrl = String.fromEnvironment(
  'API_BASE_URL',
  defaultValue: 'http://10.0.2.2:3000',
);

void main() {
  runApp(const TangTangApp());
}

class TangTangApp extends StatelessWidget {
  const TangTangApp({super.key});

  @override
  Widget build(BuildContext context) {
    const cream = Color(0xFFFFF8EA);
    const cocoa = Color(0xFF4E342E);
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: '糖糖的共享书屋',
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFFFF9A76),
          brightness: Brightness.light,
        ),
        scaffoldBackgroundColor: cream,
        textTheme: ThemeData.light().textTheme.apply(
          bodyColor: cocoa,
          displayColor: cocoa,
        ),
        cardTheme: const CardThemeData(
          color: Colors.white,
          elevation: 0,
          margin: EdgeInsets.zero,
        ),
        useMaterial3: true,
      ),
      home: const HomePage(),
    );
  }
}

class HomePage extends StatefulWidget {
  const HomePage({super.key});

  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> {
  String _apiMessage = '本地服务尚未检查';
  bool _checking = false;

  Future<void> _checkApi() async {
    setState(() {
      _checking = true;
      _apiMessage = '正在连接…';
    });

    final client = HttpClient();
    try {
      final request = await client
          .getUrl(Uri.parse('$apiBaseUrl/health'))
          .timeout(const Duration(seconds: 4));
      final response = await request.close().timeout(
        const Duration(seconds: 4),
      );
      final body = await utf8.decoder.bind(response).join();
      final data = jsonDecode(body) as Map<String, dynamic>;
      if (response.statusCode == HttpStatus.ok && data['status'] == 'ok') {
        _apiMessage = '服务连接正常';
      } else {
        _apiMessage = '服务返回异常，请检查 API';
      }
    } catch (_) {
      _apiMessage = '暂时无法连接，请先启动本地 API';
    } finally {
      client.close(force: true);
      if (mounted) {
        setState(() => _checking = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 18, 20, 32),
          children: [
            Row(
              children: [
                Container(
                  width: 48,
                  height: 48,
                  decoration: BoxDecoration(
                    color: const Color(0xFFFFD56B),
                    borderRadius: BorderRadius.circular(16),
                  ),
                  child: const Icon(Icons.auto_stories_rounded),
                ),
                const SizedBox(width: 12),
                const Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        '糖糖的共享书屋',
                        style: TextStyle(
                          fontSize: 22,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      Text('让旧书遇见新的小读者'),
                    ],
                  ),
                ),
                IconButton(
                  tooltip: '消息',
                  onPressed: () {},
                  icon: const Icon(Icons.notifications_none_rounded),
                ),
              ],
            ),
            const SizedBox(height: 24),
            Container(
              padding: const EdgeInsets.all(20),
              decoration: BoxDecoration(
                color: const Color(0xFFFFE2D5),
                borderRadius: BorderRadius.circular(28),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    '今天想读什么？',
                    style: TextStyle(fontSize: 26, fontWeight: FontWeight.w800),
                  ),
                  const SizedBox(height: 6),
                  const Text('按书名、分类或年龄段找一本好书'),
                  const SizedBox(height: 18),
                  FilledButton.icon(
                    onPressed: () {},
                    icon: const Icon(Icons.search_rounded),
                    label: const Text('去找书'),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 18),
            Row(
              children: [
                Expanded(
                  child: _ActionCard(
                    icon: Icons.photo_camera_outlined,
                    title: '拍照发布',
                    subtitle: 'AI 帮忙识别，家长确认后发布',
                    color: const Color(0xFFE4F3E8),
                    onTap: () {},
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: _ActionCard(
                    icon: Icons.assignment_turned_in_outlined,
                    title: '借还待办',
                    subtitle: '申请、交接与归还都由家长确认',
                    color: const Color(0xFFE7EDFF),
                    onTap: () {},
                  ),
                ),
              ],
            ),
            const SizedBox(height: 18),
            Card(
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(22),
              ),
              child: const Padding(
                padding: EdgeInsets.all(18),
                child: Row(
                  children: [
                    CircleAvatar(
                      backgroundColor: Color(0xFFFFF1C7),
                      child: Icon(Icons.shield_outlined),
                    ),
                    SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            '家庭隐私优先',
                            style: TextStyle(fontWeight: FontWeight.w700),
                          ),
                          SizedBox(height: 3),
                          Text('不公开孩子真实姓名、联系方式和家庭住址'),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 12),
            Card(
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(22),
              ),
              child: Padding(
                padding: const EdgeInsets.all(18),
                child: Row(
                  children: [
                    Icon(
                      _apiMessage == '服务连接正常'
                          ? Icons.cloud_done_outlined
                          : Icons.cloud_outlined,
                    ),
                    const SizedBox(width: 12),
                    Expanded(child: Text(_apiMessage)),
                    TextButton(
                      onPressed: _checking ? null : _checkApi,
                      child: Text(_checking ? '检查中' : '检查服务'),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: 0,
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.explore_outlined),
            label: '找书',
          ),
          NavigationDestination(
            icon: Icon(Icons.library_books_outlined),
            label: '书屋',
          ),
          NavigationDestination(
            icon: Icon(Icons.checklist_rounded),
            label: '待办',
          ),
          NavigationDestination(
            icon: Icon(Icons.family_restroom_rounded),
            label: '我的',
          ),
        ],
      ),
    );
  }
}

class _ActionCard extends StatelessWidget {
  const _ActionCard({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.color,
    required this.onTap,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final Color color;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: color,
      borderRadius: BorderRadius.circular(22),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(22),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(icon, size: 30),
              const SizedBox(height: 18),
              Text(
                title,
                style: const TextStyle(
                  fontSize: 17,
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(height: 5),
              Text(
                subtitle,
                style: const TextStyle(fontSize: 12, height: 1.35),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
