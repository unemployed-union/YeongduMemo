import { openDatabase } from './database/index.js';
import { AuthService } from './services/auth.js';
import { readConfig } from './config/index.js';
import { migrateLegacyAccount } from './maintenance/e2ee-migration.js';
import { backupConnection } from './maintenance/backup.js';
import {
  backupServerDatabase,
  backupSnapshotBlobs,
  verifyAttachmentBackup,
} from './maintenance/attachment-backup.js';
import { configuredBlobStore } from './storage/configured-blobs.js';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';

const [command, argument] = process.argv.slice(2);
const config = readConfig();
const databasePath = config.DATABASE_PATH;
if (command === 'backup:verify' && argument) {
  try {
    const result = await verifyAttachmentBackup(argument);
    console.log(
      `백업 무결성 확인 완료. 첨부 조각 ${result.files}개${result.legacy ? ' (첨부 도입 전 DB)' : ''}. 원래 복구 키로 별도 앱에서 복호화도 확인하세요.`,
    );
  } catch {
    console.error(
      '백업 검증에 실패했습니다. DB·첨부 sidecar·complete.json과 보관한 원본을 확인하세요.',
    );
    process.exitCode = 1;
  }
} else if (command === 'backup' && argument) {
  try {
    await backupServerDatabase(databasePath, argument, configuredBlobStore(config));
    console.log(
      'SQLite 및 첨부파일 백업을 생성했습니다. .attachments 디렉터리와 complete.json도 함께 보관하세요.',
    );
  } catch {
    console.error(
      '백업에 실패했습니다. 원본·대상 경로와 권한을 확인하세요. 기존 백업은 덮어쓰지 않습니다.',
    );
    process.exitCode = 1;
  }
} else {
  if (command === 'sync:renew-generation' && !existsSync(databasePath)) {
    console.error(
      '세대를 변경할 기존 DB가 없습니다. DATABASE_PATH를 확인하세요. 새 DB는 만들지 않습니다.',
    );
    process.exit(1);
  }
  const db = await openDatabase(databasePath);
  try {
    if (command === 'sync:renew-generation') {
      const backupPath = `${databasePath}.before-generation-${randomUUID()}.db`;
      await backupConnection(db.sqlite, backupPath);
      await backupSnapshotBlobs(backupPath, configuredBlobStore(config));
      db.sqlite.prepare('UPDATE sync_identity SET generation = ? WHERE id = 1').run(randomUUID());
      console.log(
        '서버 세대를 변경했습니다. 기존 기기의 자동 동기화는 차단되며 수동 복구가 필요합니다.',
      );
    } else if ((command === 'user:create' || command === 'e2ee:migrate') && argument) {
      // Read stdin without placing passwords in process arguments, environment, or shell history.
      let input = '';
      process.stdin.setEncoding('utf8');
      for await (const chunk of process.stdin) input += chunk;
      const secret = input.replace(/\r?\n$/, '');
      if (command === 'e2ee:migrate') {
        const backupPath = await migrateLegacyAccount(db, argument, secret, databasePath);
        console.log(`종단 간 암호화 전환 완료. 전환 전 평문 백업: ${backupPath}`);
      } else {
        const id = await new AuthService(db).createUser(argument, secret);
        console.log(`계정 생성 완료: ${id}`);
      }
    } else {
      console.error(
        '사용법: user:create email@example.com < password-file, e2ee:migrate email@example.com < recovery-key-file, backup /path/backup.db, backup:verify /path/backup.db 또는 sync:renew-generation (서버 중지 후)',
      );
      process.exitCode = 1;
    }
  } catch {
    console.error(
      '명령에 실패했습니다. 입력 형식, 계정 상태와 DB 접근 권한을 확인하세요. 비밀값은 출력하지 않습니다.',
    );
    process.exitCode = 1;
  } finally {
    db.sqlite.close();
  }
}
