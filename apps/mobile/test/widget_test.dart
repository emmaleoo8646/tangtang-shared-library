import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:mobile/main.dart';

void main() {
  testWidgets('shows the family-safe home shell', (tester) async {
    await tester.pumpWidget(const TangTangApp());

    expect(find.text('糖糖的共享书屋'), findsOneWidget);
    expect(find.text('去找书'), findsOneWidget);

    await tester.tap(find.text('发布').last);
    await tester.pumpAndSettle();
    expect(find.text('拍张封面，家长核对后再分享'), findsOneWidget);

    await tester.tap(find.text('消息').last);
    await tester.pumpAndSettle();
    expect(find.text('暂时没有新消息'), findsOneWidget);

    await tester.tap(find.text('我的书屋').last);
    await tester.pumpAndSettle();
    expect(find.text('家庭资料'), findsOneWidget);
  });

  testWidgets('filters demo books and opens a non-borrowable detail', (
    tester,
  ) async {
    await tester.pumpWidget(const TangTangApp());

    await tester.tap(find.text('去找书'));
    await tester.pumpAndSettle();
    expect(find.text('找到 3 本演示书籍'), findsOneWidget);

    await tester.enterText(find.byType(TextField), '星星');
    await tester.pumpAndSettle();
    expect(find.text('找到 1 本演示书籍'), findsOneWidget);

    await tester.tap(find.text('星星去哪儿了'));
    await tester.pumpAndSettle();
    expect(find.text('作者：待确认'), findsOneWidget);
    await tester.scrollUntilVisible(
      find.text('申请借阅 · 第 7 章开放'),
      200,
      scrollable: find.byType(Scrollable).last,
    );
    expect(find.text('申请借阅 · 第 7 章开放'), findsOneWidget);
  });
}
