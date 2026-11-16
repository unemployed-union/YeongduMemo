# 영두메모 앱 아이콘

로즈 핑크 바탕, 접힌 메모지와 길이가 줄어드는 세 줄로 구성한 앱 아이콘입니다. 내장 ImageGen으로 생성했으며, 최종 파일은 PNG 크기만 정규화했습니다. 이미지 편집과 투명 레이어 생성도 ImageGen을 사용했습니다.

| 파일                  | 크기        | 적용 위치                                                                                |
| --------------------- | ----------- | ---------------------------------------------------------------------------------------- |
| `icon.png`            | 1024 × 1024 | iOS 및 Android 기본 런처 아이콘. 전체가 불투명하며 바깥 모서리를 미리 자르지 않았습니다. |
| `adaptive-icon.png`   | 1024 × 1024 | Android 적응형 전경. 투명 배경, 로즈 색상 배경은 앱 설정에서 지정합니다.                 |
| `monochrome-icon.png` | 1024 × 1024 | Android 13 이상 테마 아이콘용 알파 마스크. 표시 색상은 OS가 결정합니다.                  |
| `brand-icon.png`      | 144 × 144   | 앱 안의 사이드바와 설정 화면. 48pt 표시까지 고려한 작은 이미지입니다.                    |

적응형/단색 아이콘의 실질적인 전경 픽셀(alpha > 16)이 중앙 지름 66/108 안전 원 안에 들어가는지 확인했습니다. 완전 불투명한 기본 아이콘과 투명 전경을 구분하여 검사했습니다. Expo 적용 방식은 [앱 아이콘 공식 문서](https://docs.expo.dev/develop/user-interface/splash-screen-and-app-icon/)를 따릅니다.

적용 설정은 `apps/mobile/app.config.ts`입니다. 아이콘 변경은 Metro 새로고침만으로 런처에 적용되지 않으므로 네이티브 앱을 다시 빌드해야 합니다. 기존 앱 데이터를 삭제하거나 앱을 제거할 필요는 없습니다.

## 생성 프롬프트

2026-11-07, 내장 `image_gen.imagegen` 사용. 첫 번째 이미지에서 기본/브랜드 아이콘을, 후속 편집에서 적응형 전경과 단색 마스크를 만들었습니다. 중간에 버린 투명 레이어는 사용하지 않았습니다.

### 기본 아이콘

```text
Use case: logo-brand. Asset type: production iOS and Android launcher app icon for a Korean private Markdown notes app called Yeongdu Memo. Generate one single square 1024x1024 icon, full bleed, no mockup or presentation. Background: a rich solid rose pink close to #D92F5B filling every pixel, perfectly square with NO pre-rounded external corners. Subject: a beautifully simple, bold, warm white memo page with one softly folded upper-right corner, and three short rose-colored rounded writing strokes subtly descending in length, suggesting collected thoughts. The page has gently softened corners, slightly tactile paper and exceptionally restrained shallow relief, elegant precise silhouette, almost flat and very legible at 32px. A very subtle darker rose shadow beneath the page adds only a little depth. Centered balanced composition, main white page approximately 54 percent canvas width and 64 percent canvas height, generous even breathing room. Visual family: polished, friendly contemporary music-app rose palette, matching a clean Korean productivity app. No pencil, no lock, no extra decorative objects, no sparkle, no letters, no text, no watermark, no border, no phone render, no surrounding whitespace, no transparency.
```

### 적응형 전경 (기본 아이콘을 참조한 편집)

```text
Use the attached icon only as a shape reference for a clean Android adaptive foreground. Render ONE fully opaque WARM WHITE paper sheet with a small top-right folded corner and three rose pink #D92F5B writing strokes, isolated on genuine fully transparent background. Preserve the page silhouette and three descending-length lines from the reference. Flat crisp vector-like fills only: absolutely no texture, no lighting, no drop shadow, no haze, no glow, no cast shadow, no checkerboard, no gray field, no rose field. All pixels outside the paper silhouette MUST be completely transparent alpha zero; the inside of the paper MUST be fully opaque white alpha 255. The white page and the fold should use distinct crisp solid tones, without any translucent shading. Canvas square. Page centered and occupying only 36 percent of image width and 43 percent of image height, with large transparent padding on all four sides. Output a production PNG foreground asset, not a mockup.
```

### 단색 마스크 (적응형 전경을 참조한 편집)

```text
Create the Android 13 themed-icon monochrome mask from this adaptive icon foreground. Preserve the EXACT same centered sheet silhouette, folded-corner geometry, position, scale, and generous transparent canvas. Convert the sheet into one fully opaque solid black silhouette with three completely transparent rounded horizontal cutout writing lines, descending in length as in the reference. Fold can be represented as a small transparent diagonal inset, keeping the page recognizable. Only opaque black ink and fully transparent pixels, with normal edge antialiasing. No gray fills, no rose, no white paper, no texture, no shadow, no glow, no surrounding badge or frame, no background. This is an alpha mask: everything outside the sheet and inside the writing-line cutouts must have zero alpha.
```
