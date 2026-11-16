import { useEffect, useState } from 'react';
import { Alert, Image, Text, View } from 'react-native';
import { FileText, Download, Share2, X } from 'lucide-react-native';
import { type Attachment } from '@yeongdu/shared/src/attachments';
import { attachmentPreview, canPreviewImage, shareAttachment } from '../services/attachments';
import { useRuntime } from '../services/runtime';
import { useTheme } from '../theme';
import { Button } from './ui';

export function AttachmentCard({
  noteId,
  file,
  onRemove,
  loadPreview = true,
}: {
  noteId: string;
  file: Attachment;
  onRemove?: () => void;
  loadPreview?: boolean;
}) {
  const t = useTheme();
  const active = useRuntime((state) => state.active && state.unlocked);
  const version = useRuntime((state) => state.categoryVersion);
  const [uri, setUri] = useState('');
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const preview = canPreviewImage(file);
  const ratio =
    file.width && file.height ? Math.max(0.25, Math.min(4, file.width / file.height)) : 1.5;
  useEffect(() => {
    let cancelled = false;
    setUri('');
    setError('');
    if (active && preview && (loadPreview || reload > 0)) {
      void attachmentPreview(noteId, file.id, () => !cancelled)
        .then((result) => {
          if (!cancelled) {
            setUri(result);
          }
        })
        .catch((reason) => {
          if (!cancelled) {
            setError(reason instanceof Error ? reason.message : '이미지를 불러오지 못했습니다.');
          }
        });
    }
    return () => {
      cancelled = true;
    };
  }, [active, version, noteId, file.id, file.blobId, preview, reload, loadPreview]);
  if (!active) {
    return null;
  }
  return (
    <View
      style={{
        marginVertical: t.spacing.sm,
        backgroundColor: t.inset,
        borderRadius: t.radius.md,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: t.line,
      }}
    >
      {preview && (
        <View style={{ width: '100%', aspectRatio: ratio, maxHeight: 520 }}>
          {uri ? (
            <Image
              source={{ uri }}
              resizeMode="contain"
              accessibilityLabel={file.name}
              onError={() =>
                setError('이 기기에서 이미지 미리보기를 지원하지 않습니다. 파일로 열 수 있습니다.')
              }
              style={{ width: '100%', height: '100%' }}
            />
          ) : (
            <View
              style={{
                flex: 1,
                justifyContent: 'center',
                alignItems: 'center',
                padding: t.spacing.md,
              }}
            >
              <Text style={{ color: t.secondary }}>
                {error || (loadPreview ? '이미지를 불러오는 중…' : '이미지 미리보기')}
              </Text>
            </View>
          )}
        </View>
      )}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: t.spacing.sm,
          padding: t.spacing.sm,
        }}
      >
        {!preview && <FileText color={t.accent} size={24} accessible={false} />}
        <View style={{ flex: 1 }}>
          <Text numberOfLines={2} style={{ color: t.text, fontWeight: '600', lineHeight: 21 }}>
            {file.name}
          </Text>
          <Text style={{ color: t.secondary, fontSize: 12 }}>
            {(file.size / 1024).toFixed(0)} KB
            {file.width && file.height ? ` · ${file.width} × ${file.height}` : ''}
          </Text>
        </View>
        {preview && (
          <Button
            title="이미지 다시 불러오기"
            icon={Download}
            iconOnly
            disabled={busy}
            onPress={() => setReload((value) => value + 1)}
          />
        )}
        <Button
          title="파일 열기·공유"
          icon={Share2}
          iconOnly
          disabled={busy}
          onPress={() => {
            Alert.alert('파일 열기·공유', '선택한 앱에는 복호화한 평문 파일이 전달됩니다.', [
              { text: '취소', style: 'cancel' },
              {
                text: '계속',
                onPress: () => {
                  setBusy(true);
                  void shareAttachment(noteId, file.id)
                    .catch((reason) =>
                      Alert.alert(
                        '첨부파일',
                        reason instanceof Error ? reason.message : '파일을 열지 못했습니다.',
                      ),
                    )
                    .finally(() => setBusy(false));
                },
              },
            ]);
          }}
        />
        {onRemove && (
          <Button
            title="메모에서 첨부 제거"
            icon={X}
            iconOnly
            disabled={busy}
            onPress={() =>
              Alert.alert(
                '첨부파일을 제거할까요?',
                '이 메모의 첨부와 본문 링크를 제거합니다. 다른 메모·충돌 사본과 백업은 유지합니다.',
                [
                  { text: '취소', style: 'cancel' },
                  { text: '제거', style: 'destructive', onPress: onRemove },
                ],
              )
            }
          />
        )}
      </View>
      {!!error && !!uri && <Text style={{ color: t.danger, padding: t.spacing.sm }}>{error}</Text>}
    </View>
  );
}
