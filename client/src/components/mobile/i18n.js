/* 폰 화면 문구 — 옵션 '시스템 언어'(한국어·English·日本語). 엔진 오류 같은 드문 안내(TranslateView)는 한국어 그대로다.
   언어 이름은 Intl.DisplayNames(안드로이드 WebView 지원)로 만들고, 없을 때만 아래 표를 쓴다. */
import { useMemo } from 'react';
import { usePrefs } from './prefs.js';

const D = {
  ko: {
    required: '입력해 주세요: {f}',
    done: '완료', cancel: '취소', save: '저장', close: '닫기', back: '뒤로', selected: '선택됨', delete: '삭제',
    autoDetect: '자동 감지', untitled: '제목 없음', netError: '네트워크 오류',
    justNow: '방금 전', minAgo: '{n}분 전', hourAgo: '{n}시간 전',
    modeOneway: '실시간 번역', modeTwoway: '양방향 통역',
    modeOnewayDesc: '시스템 혹은 마이크 입력 음성을 실시간으로 번역합니다.',
    modeTwowayDesc: '지정한 두 언어를 상대방 언어로 통역합니다.',
    settings: '설정', newSession: '새 세션', emptyTitle: '아직 세션이 없습니다', emptyHint: '오른쪽 아래 + 버튼으로 시작하세요.',
    inputLang: '입력 언어', outputLang: '출력 언어', myLang: '내 언어', otherLang: '상대 언어', swapLangs: '두 언어 바꾸기',
    sessionName: '세션 이름', sessionNamePh: '예: 외국인 방문객 안내', nameRequired: '세션 이름을 입력하세요.',
    create: '만들기', createFail: '세션을 만들지 못했습니다: {msg}',
    accountSettings: '계정 설정', secLanguage: '언어', sysLang: '시스템 언어', nativeLang: '모국어',
    secVoice: '음성', inputSens: '입력 감도', inputSensHint: '말소리가 초록색 구간에 오도록 마이크 감도를 조절하세요.', connectedDevice: '연결된 기기', version: '버전', latestVersion: '최신 버전', updateTo: '업데이트 ({v})',
    ttsVoice: 'TTS 음성', ttsVoiceDesc: '번역문을 읽어 줄 목소리를 고르세요.', female: '여성', male: '남성',
    previewVoice: '{v} 음성 미리 듣기', previewFail: '미리 듣기에 실패했습니다.',
    secDisplay: '화면', theme: '테마', themeLight: '라이트', themeDark: '다크', themeSystem: '시스템', textSize: '텍스트 크기', sampleGlyph: '가',
    logout: '로그아웃', logoutConfirm: '로그아웃하시겠습니까?',
    account: '계정', accountInfo: '계정 정보', username: '사용자명', email: '이메일', notSet: '없음',
    changePassword: '비밀번호 변경', currentPassword: '현재 비밀번호', newPassword: '새 비밀번호', confirmPassword: '새 비밀번호 확인',
    pwMismatch: '새 비밀번호가 일치하지 않습니다.', pwChanged: '비밀번호를 바꿨습니다.',
    deleteAccount: '계정 삭제', deleteAccountDesc: '계정과 내 세션이 모두 삭제되며 되돌릴 수 없습니다. 계속하려면 비밀번호를 입력하세요.',
    adminManaged: '관리자 계정의 사용자명·비밀번호는 서버 설정으로 관리됩니다.', saved: '저장했습니다.', saveFail: '저장하지 못했습니다: {msg}',
    emailInvalid: '이메일 형식이 올바르지 않습니다.', emailPh: 'name@example.com',
    updateTitle: '새 버전이 있습니다', update: '업데이트', updateSize: '업데이트 ({mb}MB)', later: '나중에',
    downloading: '내려받는 중… {p}', installHint: "설치 화면에서 '업데이트'를 누르세요. 처음 한 번은 'AirTalk에서 앱 설치 허용'을 켜야 할 수 있습니다.",
    downloadFail: '내려받지 못했습니다. 네트워크를 확인하고 다시 눌러 주세요.', retry: '다시 시도', reopenInstall: '설치 화면 다시 열기',
    backToList: '세션 목록으로', translating: '번역 중', interpreting: '통역 중', reconnecting: '다시 연결하는 중',
    engineConnecting: '엔진 연결 중… 첫 인식까지 몇 초 걸릴 수 있어요.',
    readyHint: '[시작] 버튼을 눌러 번역을 시작하세요.', speakNow: '말씀하세요. 인식되는 대로 여기에 표시됩니다.',
    tapHint: '화면을 누르면 메뉴가 나타납니다', pending: '번역 중…',
    mute: '음소거', unmute: '음소거 해제', tts: 'TTS', ttsOff: 'TTS 꺼짐', start: '시작', stop: '중지', end: '종료',
    sessionSettings: '세션 설정', endTitle: '번역을 종료하시겠습니까?', endDesc: '지금까지의 내용은 저장됩니다.',
    micPicker: '마이크 선택', micAuto: '자동', micAutoSub: '외부 마이크를 꽂으면 그쪽을 씁니다',
    micBuiltin: '내장 마이크', micBuiltinSub: '휴대폰 마이크', micUsb: 'USB 마이크', micWired: '유선 이어폰 마이크',
    micBt: '블루투스', micBtWarn: '통화용 음질이라 인식률이 낮을 수 있음', twoCh: '2채널', micNeedUpdate: '앱을 업데이트하면 마이크를 직접 고를 수 있습니다.',
    micAria: '마이크 선택: {name}',
    language: '언어', langLocked: '번역 중에는 언어를 바꿀 수 없습니다 — 중지한 뒤 바꾸세요.',
    langSubOne: '말한 내용을 출력 언어로 보여줍니다', langSubTwo: '서로의 말을 상대 언어로 통역합니다',
    shareLink: '링크 공유', shareHint: 'QR을 스캔하면 이 세션의 번역을 각자 휴대폰으로 볼 수 있습니다.', copyLink: '주소 복사', copied: '복사됨', share: '공유', generating: '생성 중…',
    saveTranscript: '녹취록 저장', ttsEnable: 'TTS (번역 음성)', ttsEnableSub: '켜면 번역문을 음성으로 만들어 링크로 접속한 휴대폰에 보냅니다. 이 폰에서도 들을지는 하단 TTS 버튼으로 정합니다.', ttsNeedEnable: '세션 설정에서 TTS를 켜면 사용할 수 있습니다.',
    rename: '세션 이름 수정', clearHistory: '대화 내역 삭제', clearConfirm: '이 세션의 대화 내역을 모두 삭제합니다. 세션은 그대로 유지되며 되돌릴 수 없습니다.',
    cleared: '대화 내역을 삭제했습니다.', deleteSession: '세션 삭제', deleteConfirm: "'{name}' 세션을 삭제합니다. 목록에서 사라집니다.", failMsg: '실패했습니다: {msg}',
  },
  en: {
    required: 'Required: {f}',
    done: 'Done', cancel: 'Cancel', save: 'Save', close: 'Close', back: 'Back', selected: 'Selected', delete: 'Delete',
    autoDetect: 'Auto detect', untitled: 'Untitled', netError: 'Network error',
    justNow: 'Just now', minAgo: '{n} min ago', hourAgo: '{n} h ago',
    modeOneway: 'Live translation', modeTwoway: 'Two-way interpreting',
    modeOnewayDesc: 'Translates system or microphone audio in real time.',
    modeTwowayDesc: 'Interprets between two languages, each into the other.',
    settings: 'Settings', newSession: 'New session', emptyTitle: 'No sessions yet', emptyHint: 'Tap + at the bottom right to start.',
    inputLang: 'Input language', outputLang: 'Output language', myLang: 'My language', otherLang: 'Their language', swapLangs: 'Swap languages',
    sessionName: 'Session name', sessionNamePh: 'e.g. Visitor tour', nameRequired: 'Enter a session name.',
    create: 'Create', createFail: 'Could not create the session: {msg}',
    accountSettings: 'Account settings', secLanguage: 'Language', sysLang: 'App language', nativeLang: 'Native language',
    secVoice: 'Voice', inputSens: 'Input sensitivity', inputSensHint: 'Adjust the sensitivity so your voice reaches the green range.', connectedDevice: 'Connected device', version: 'Version', latestVersion: 'Up to date', updateTo: 'Update ({v})',
    ttsVoice: 'TTS voice', ttsVoiceDesc: 'Choose the voice that reads translations aloud.', female: 'Female', male: 'Male',
    previewVoice: 'Preview {v} voice', previewFail: 'Could not play the preview.',
    secDisplay: 'Display', theme: 'Theme', themeLight: 'Light', themeDark: 'Dark', themeSystem: 'System', textSize: 'Text size', sampleGlyph: 'A',
    logout: 'Log out', logoutConfirm: 'Log out?',
    account: 'Account', accountInfo: 'Account info', username: 'Username', email: 'Email', notSet: 'Not set',
    changePassword: 'Change password', currentPassword: 'Current password', newPassword: 'New password', confirmPassword: 'Confirm new password',
    pwMismatch: 'The new passwords do not match.', pwChanged: 'Password changed.',
    deleteAccount: 'Delete account', deleteAccountDesc: 'Your account and sessions will be deleted permanently. Enter your password to continue.',
    adminManaged: 'The admin username and password are managed in the server settings.', saved: 'Saved.', saveFail: 'Could not save: {msg}',
    emailInvalid: 'Enter a valid email address.', emailPh: 'name@example.com',
    updateTitle: 'Update available', update: 'Update', updateSize: 'Update ({mb} MB)', later: 'Later',
    downloading: 'Downloading… {p}', installHint: "Tap 'Update' on the install screen. The first time, you may need to allow installs from AirTalk.",
    downloadFail: 'Download failed. Check your connection and try again.', retry: 'Try again', reopenInstall: 'Open install screen again',
    backToList: 'Back to sessions', translating: 'Translating', interpreting: 'Interpreting', reconnecting: 'Reconnecting',
    engineConnecting: 'Connecting… the first result may take a few seconds.',
    readyHint: 'Press [Start] to begin translating.', speakNow: 'Go ahead and speak. Text appears here as it is recognized.',
    tapHint: 'Tap the screen to show the menu', pending: 'Translating…',
    mute: 'Mute', unmute: 'Unmute', tts: 'TTS', ttsOff: 'TTS off', start: 'Start', stop: 'Stop', end: 'End',
    sessionSettings: 'Session settings', endTitle: 'End translation?', endDesc: 'Everything so far is saved.',
    micPicker: 'Microphone', micAuto: 'Automatic', micAutoSub: 'Uses an external mic when one is connected',
    micBuiltin: 'Built-in microphone', micBuiltinSub: 'Phone microphone', micUsb: 'USB microphone', micWired: 'Wired headset mic',
    micBt: 'Bluetooth', micBtWarn: 'Call-quality audio; recognition may be worse', twoCh: '2-channel', micNeedUpdate: 'Update the app to choose the microphone.',
    micAria: 'Microphone: {name}',
    language: 'Language', langLocked: 'Stop translating before changing languages.',
    langSubOne: 'Shows speech in the output language', langSubTwo: 'Interprets each side into the other language',
    shareLink: 'Share link', shareHint: 'Scan the QR code to follow this session on your own phone.', copyLink: 'Copy link', copied: 'Copied', share: 'Share', generating: 'Generating…',
    saveTranscript: 'Save transcript', ttsEnable: 'TTS (spoken translation)', ttsEnableSub: 'Speaks translations to phones that joined via the link. Use the TTS button below to also play them on this phone.', ttsNeedEnable: 'Turn on TTS in session settings first.',
    rename: 'Rename session', clearHistory: 'Clear conversation', clearConfirm: 'Deletes the whole conversation of this session. The session stays. This cannot be undone.',
    cleared: 'Conversation cleared.', deleteSession: 'Delete session', deleteConfirm: "Delete '{name}'? It will disappear from the list.", failMsg: 'Failed: {msg}',
  },
  ja: {
    required: '入力してください：{f}',
    done: '完了', cancel: 'キャンセル', save: '保存', close: '閉じる', back: '戻る', selected: '選択中', delete: '削除',
    autoDetect: '自動検出', untitled: '無題', netError: 'ネットワークエラー',
    justNow: 'たった今', minAgo: '{n}分前', hourAgo: '{n}時間前',
    modeOneway: 'リアルタイム翻訳', modeTwoway: '双方向通訳',
    modeOnewayDesc: 'システムまたはマイクの音声をリアルタイムで翻訳します。',
    modeTwowayDesc: '指定した2つの言語を相手の言語に通訳します。',
    settings: '設定', newSession: '新しいセッション', emptyTitle: 'セッションはまだありません', emptyHint: '右下の＋ボタンで始めましょう。',
    inputLang: '入力言語', outputLang: '出力言語', myLang: '自分の言語', otherLang: '相手の言語', swapLangs: '言語を入れ替える',
    sessionName: 'セッション名', sessionNamePh: '例：海外ゲスト案内', nameRequired: 'セッション名を入力してください。',
    create: '作成', createFail: 'セッションを作成できませんでした：{msg}',
    accountSettings: 'アカウント設定', secLanguage: '言語', sysLang: '表示言語', nativeLang: '母語',
    secVoice: '音声', inputSens: '入力感度', inputSensHint: '話し声が緑の範囲に入るようにマイク感度を調整してください。', connectedDevice: '接続中のデバイス', version: 'バージョン', latestVersion: '最新バージョン', updateTo: 'アップデート（{v}）',
    ttsVoice: '読み上げ音声', ttsVoiceDesc: '翻訳文を読み上げる声を選んでください。', female: '女性', male: '男性',
    previewVoice: '{v}の声を試聴', previewFail: '試聴できませんでした。',
    secDisplay: '画面', theme: 'テーマ', themeLight: 'ライト', themeDark: 'ダーク', themeSystem: 'システム', textSize: '文字サイズ', sampleGlyph: 'あ',
    logout: 'ログアウト', logoutConfirm: 'ログアウトしますか？',
    account: 'アカウント', accountInfo: 'アカウント情報', username: 'ユーザー名', email: 'メール', notSet: '未設定',
    changePassword: 'パスワード変更', currentPassword: '現在のパスワード', newPassword: '新しいパスワード', confirmPassword: '新しいパスワード（確認）',
    pwMismatch: '新しいパスワードが一致しません。', pwChanged: 'パスワードを変更しました。',
    deleteAccount: 'アカウント削除', deleteAccountDesc: 'アカウントと自分のセッションがすべて削除され、元に戻せません。続けるにはパスワードを入力してください。',
    adminManaged: '管理者アカウントのユーザー名・パスワードはサーバー設定で管理されています。', saved: '保存しました。', saveFail: '保存できませんでした：{msg}',
    emailInvalid: 'メールアドレスの形式が正しくありません。', emailPh: 'name@example.com',
    updateTitle: '新しいバージョンがあります', update: 'アップデート', updateSize: 'アップデート（{mb}MB）', later: '後で',
    downloading: 'ダウンロード中… {p}', installHint: 'インストール画面で「アップデート」を押してください。初回は「AirTalkからのインストールを許可」が必要な場合があります。',
    downloadFail: 'ダウンロードできませんでした。ネットワークを確認してもう一度押してください。', retry: '再試行', reopenInstall: 'インストール画面をもう一度開く',
    backToList: 'セッション一覧へ', translating: '翻訳中', interpreting: '通訳中', reconnecting: '再接続中',
    engineConnecting: '接続中…最初の認識まで数秒かかることがあります。',
    readyHint: '[開始] ボタンを押して翻訳を始めてください。', speakNow: '話してください。認識された内容がここに表示されます。',
    tapHint: '画面をタップするとメニューが表示されます', pending: '翻訳中…',
    mute: 'ミュート', unmute: 'ミュート解除', tts: 'TTS', ttsOff: 'TTS オフ', start: '開始', stop: '停止', end: '終了',
    sessionSettings: 'セッション設定', endTitle: '翻訳を終了しますか？', endDesc: 'ここまでの内容は保存されます。',
    micPicker: 'マイク選択', micAuto: '自動', micAutoSub: '外部マイクを接続するとそちらを使います',
    micBuiltin: '内蔵マイク', micBuiltinSub: 'スマホのマイク', micUsb: 'USBマイク', micWired: '有線イヤホンマイク',
    micBt: 'Bluetooth', micBtWarn: '通話用の音質のため認識率が下がることがあります', twoCh: '2チャンネル', micNeedUpdate: 'アプリを更新するとマイクを選べます。',
    micAria: 'マイク選択：{name}',
    language: '言語', langLocked: '翻訳中は言語を変更できません。停止してから変更してください。',
    langSubOne: '話した内容を出力言語で表示します', langSubTwo: 'お互いの言葉を相手の言語に通訳します',
    shareLink: 'リンク共有', shareHint: 'QRコードを読み取ると、このセッションの翻訳を各自のスマホで見られます。', copyLink: 'リンクをコピー', copied: 'コピーしました', share: '共有', generating: '生成中…',
    saveTranscript: '記録を保存', ttsEnable: 'TTS（翻訳音声）', ttsEnableSub: '翻訳文を音声にして、リンクから参加したスマホに送ります。この端末でも聞くかは下のTTSボタンで切り替えます。', ttsNeedEnable: 'セッション設定でTTSをオンにすると使えます。',
    rename: 'セッション名を変更', clearHistory: '会話履歴を削除', clearConfirm: 'このセッションの会話履歴をすべて削除します。セッションは残り、元に戻せません。',
    cleared: '会話履歴を削除しました。', deleteSession: 'セッションを削除', deleteConfirm: '「{name}」を削除します。一覧から消えます。', failMsg: '失敗しました：{msg}',
  },
};

// Intl.DisplayNames 가 없을 때만 쓰는 최소 표
const FALLBACK = {
  ko: { ko: '한국어', en: '영어', ja: '일본어', zh: '중국어', es: '스페인어', fr: '프랑스어', de: '독일어', ru: '러시아어', vi: '베트남어', th: '태국어', id: '인도네시아어' },
  en: { ko: 'Korean', en: 'English', ja: 'Japanese', zh: 'Chinese', es: 'Spanish', fr: 'French', de: 'German', ru: 'Russian', vi: 'Vietnamese', th: 'Thai', id: 'Indonesian' },
  ja: { ko: '韓国語', en: '英語', ja: '日本語', zh: '中国語', es: 'スペイン語', fr: 'フランス語', de: 'ドイツ語', ru: 'ロシア語', vi: 'ベトナム語', th: 'タイ語', id: 'インドネシア語' },
};
const ENDONYM = { ko: '한국어', en: 'English', ja: '日本語', zh: '中文', es: 'Español', fr: 'Français', de: 'Deutsch', ru: 'Русский', vi: 'Tiếng Việt', th: 'ไทย', id: 'Bahasa Indonesia' };

const dnCache = {};
function displayName(inLang, code) {
  if (!(inLang in dnCache)) { try { dnCache[inLang] = new Intl.DisplayNames([inLang], { type: 'language' }); } catch { dnCache[inLang] = null; } }
  let s = null;
  try { s = dnCache[inLang] && dnCache[inLang].of(code); } catch {}
  if (!s || s === code) return null;
  return s.charAt(0).toLocaleUpperCase(inLang) + s.slice(1);
}

// code 를 UI 언어로 부른 이름(영어 → '영어'/'English'/'英語')
export function langName(code, ui) {
  if (code === 'auto') return (D[ui] || D.ko).autoDetect;
  return displayName(ui, code) || (FALLBACK[ui] && FALLBACK[ui][code]) || FALLBACK.en[code] || code;
}
// 그 언어 자신의 이름(English, 日本語) — 언어 고르는 목록의 큰 글씨
export function endonym(code) {
  return ENDONYM[code] || displayName(code, code) || code;
}

export function makeT(ui) {
  const d = D[ui] || D.ko;
  const t = (k, vars) => {
    let s = d[k] != null ? d[k] : D.ko[k] != null ? D.ko[k] : k;
    if (vars) s = s.replace(/\{(\w+)\}/g, (_, n) => (vars[n] != null ? String(vars[n]) : ''));
    return s;
  };
  t.ui = ui;
  t.lang = (code) => langName(code, ui);
  t.locale = { ko: 'ko-KR', en: 'en-US', ja: 'ja-JP' }[ui] || 'ko-KR';
  return t;
}

export function useT() {
  const { sysLang } = usePrefs();
  return useMemo(() => makeT(sysLang), [sysLang]);
}
