#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "$0")/.." && pwd)"
export JAVA_HOME="${JAVA_HOME:-/Applications/Android Studio.app/Contents/jbr/Contents/Home}"
flutter_executable="$(command -v flutter)"
flutter_sdk="$(cd "$(dirname "$flutter_executable")/.." && pwd)"
android_sdk="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
local_properties="${project_root}/apps/mobile/android/local.properties"

if [[ ! -f "$local_properties" ]]; then
  printf 'flutter.sdk=%s\nsdk.dir=%s\n' "$flutter_sdk" "$android_sdk" > "$local_properties"
fi

cd "${project_root}/apps/mobile"
flutter --no-version-check pub get

cd "${project_root}/apps/mobile/android"
./gradlew -I "${project_root}/infra/local/gradle-mirrors.init.gradle" assembleDebug
