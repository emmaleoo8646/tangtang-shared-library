import 'package:flutter_test/flutter_test.dart';

import 'package:mobile/main.dart';

void main() {
  testWidgets('shows the family-safe home shell', (tester) async {
    await tester.pumpWidget(const TangTangApp());

    expect(find.text('糖糖的共享书屋'), findsOneWidget);
    expect(find.text('家庭隐私优先'), findsOneWidget);
    expect(find.text('检查服务'), findsOneWidget);
  });
}
