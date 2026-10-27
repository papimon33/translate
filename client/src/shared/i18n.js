/* 폰 화면 문구 — 옵션 '시스템 언어'(한국어·English·日本語). 엔진 오류 같은 드문 안내(TranslateView)는 한국어 그대로다.
   언어 이름은 Intl.DisplayNames(안드로이드 WebView 지원)로 만들고, 없을 때만 아래 표를 쓴다. */
import { useMemo } from 'react';
import { usePrefs } from './prefs.js';

const D = {
  ko: {
    micCheckTitle: '마이크 확인', micCheckDesc: '각 마이크에 차례로 말해 보세요. 말하는 쪽이 강조됩니다.', micHost: '호스트', micGuest: '상대방', mic1: '마이크 1', mic2: '마이크 2', micChecked: '확인됨', micSpeak: '말해 보세요', 
    micCheckDescOne: '마이크에 대고 말해 보세요.', micOne: '마이크', startOneMic: '마이크 1개로 시작',
    pcSource: '음성 입력', srcMic: '마이크', srcSystem: 'PC 소리', srcBoth: '마이크 + PC 소리', pcMicDevice: '마이크 장치', defaultMic: '기본 마이크', pcMode: '모드', advanced: '고급 설정', overlayWin: '오버레이 창', lockedWhileRec: '번역 중에는 바꿀 수 없습니다. 중지한 뒤 바꾸세요.',
    renameShort: '이름 바꾸기', sessionDeleted: '세션을 삭제했습니다.',
    joinCode: '참여 코드', joinAt: '{host} 에서 입력',
    openSettings: '설정 열기', speakerAria: '이 기기에서 번역 음성 재생', muteNeedRec: '번역을 시작한 뒤 음소거할 수 있습니다.',
    mutedMsg: '음소거했습니다.', unmutedMsg: '음소거를 해제했습니다.',
    ttsOnMsg: '참가자의 번역 음성 재생을 켰습니다.', ttsOffMsg: '참가자의 번역 음성 재생을 껐습니다.',
    speakerOnMsg: '이 기기에서 번역 음성을 재생합니다.', speakerOffMsg: '이 기기에서는 번역 음성을 재생하지 않습니다.', speakerNeedTts: 'TTS를 켜면 이 기기에서도 들을 수 있습니다.',
    secInput: '입력', secOutput: '출력', secSession: '세션', inputDevice: '입력 장치',
    autoSens: '자동으로 감도 조절', autoSensHint: '주변 소음에 맞춰 감도를 자동으로 조절합니다.',
    viewers: '뷰어', viewersCount: '{n}명',
    required: '입력해 주세요: {f}',
    done: '완료', cancel: '취소', save: '저장', back: '뒤로', selected: '선택됨', delete: '삭제',
    autoDetect: '자동 감지', untitled: '제목 없음', netError: '네트워크 오류',
    justNow: '방금 전', minAgo: '{n}분 전', hourAgo: '{n}시간 전',
    modeOneway: '실시간 번역', modeTwoway: '양방향 통역',
    modeOnewayDesc: '시스템 혹은 마이크 입력 음성을 실시간으로 번역합니다.',
    modeTwowayDesc: '지정한 두 언어를 상대방 언어로 통역합니다.',
    settings: '설정', newSession: '새 세션', emptyTitle: '아직 세션이 없습니다', emptyHint: '오른쪽 아래 + 버튼으로 시작하세요.',
    inputLang: '입력 언어', outputLang: '출력 언어', myLang: '내 언어', otherLang: '상대 언어', swapLangs: '두 언어 바꾸기',
    sessionName: '세션 이름', nameRequired: '세션 이름을 입력하세요.',
    create: '만들기', createFail: '세션을 만들지 못했습니다: {msg}',
    next: '다음', nsMode: '어떤 세션을 만들까요?', nsSrc: '어떤 언어를 번역할까요?', nsTarget: '어떤 언어로 번역할까요?', nsMine: '내 언어를 고르세요', nsOther: '상대 언어를 고르세요', nsName: '세션 이름을 정하세요',
    accountSettings: '계정 설정', secLanguage: '언어', sysLang: '시스템 언어', nativeLang: '모국어',
    secVoice: '음성', inputSens: '입력 감도', inputSensHint: '말할 때 표시 막대가 초록색 구간에 오도록 조절하세요.', tx1: '마이크 1', tx2: '마이크 2', stereoOk: '2채널 입력: 두 마이크의 소리를 각각 인식합니다.', stereoMono: '두 마이크의 소리가 같아 마이크 1개로 인식합니다. 수신기를 스테레오 모드로 바꾸면 나눠서 인식합니다.', stereoTry: '각 마이크에 차례로 말해 보세요. 막대가 각각 움직이면 정상입니다.', version: '버전', latestVersion: '최신 버전', updateTo: '업데이트 ({v})',
    ttsVoice: 'TTS 음성', ttsVoiceDesc: '번역문을 읽어 줄 목소리를 고르세요.', female: '여성', male: '남성',
    previewVoice: '{v} 음성 미리 듣기', previewFail: '미리 듣기를 재생하지 못했습니다.',
    secDisplay: '화면', theme: '테마', themeLight: '라이트', themeDark: '다크', themeSystem: '시스템', textSize: '텍스트 크기', sampleGlyph: '가',
    logout: '로그아웃', logoutConfirm: '로그아웃하시겠습니까?',
    account: '계정', accountInfo: '계정 정보', username: '사용자명', 
    changePassword: '비밀번호 변경', currentPassword: '현재 비밀번호', newPassword: '새 비밀번호', confirmPassword: '새 비밀번호 확인',
    pwMismatch: '새 비밀번호가 일치하지 않습니다.', pwChanged: '비밀번호를 바꾸고 다른 기기에서 로그아웃했습니다.',
    deleteAccount: '계정 삭제', deleteAccountDesc: '계정과 모든 세션이 삭제되며 되돌릴 수 없습니다. 계속하려면 비밀번호를 입력하세요.',
    saved: '저장했습니다.', 
    
    updateTitle: '새 버전이 있습니다', update: '업데이트', updateSize: '업데이트 ({mb}MB)', later: '나중에',
    downloading: '다운로드 중… {p}', installHint: "설치 화면에서 '업데이트'를 누르세요. 처음 한 번은 'AirTalk에서 앱 설치 허용'을 켜야 할 수 있습니다.",
    downloadFail: '다운로드하지 못했습니다. 네트워크를 확인한 뒤 다시 시도하세요.', retry: '다시 시도', reopenInstall: '설치 화면 다시 열기',
    translating: '번역 중', interpreting: '통역 중', 
    engineConnecting: '번역 서비스 연결 중입니다. 잠시 기다려 주세요.',
    readyHint: '시작 버튼을 눌러 번역을 시작하세요.', speakNow: '말씀하시면 인식된 내용이 표시됩니다.',
    tapHint: '화면을 누르면 메뉴가 표시됩니다.', pending: '번역 중…',
    mute: '음소거', unmute: '음소거 해제', tts: 'TTS', ttsOff: 'TTS 꺼짐', start: '시작', stop: '중지', end: '종료',
    endTitle: '번역을 종료하시겠습니까?', endDesc: '지금까지의 내용은 저장됩니다.',
    micPicker: '마이크 선택', 
    micBuiltin: '내장 마이크', micBuiltinSub: '휴대폰 마이크', micUsb: 'USB 마이크', micWired: '유선 이어폰 마이크',
    micBt: '블루투스', twoCh: '2채널', micNeedUpdate: '앱을 업데이트하면 마이크를 직접 고를 수 있습니다.',
    
    language: '언어', langLocked: '번역 중에는 언어를 바꿀 수 없습니다. 중지한 뒤 바꾸세요.',
    langSubOne: '말한 내용을 출력 언어로 보여줍니다', langSubTwo: '서로의 말을 상대 언어로 통역합니다',
    shareLink: '링크 공유', shareHint: 'QR을 찍거나 참여 코드를 입력하면 이 세션의 번역을 각자 휴대폰으로 볼 수 있습니다.', copyLink: '주소 복사', copied: '복사됨', share: '공유', generating: '생성 중…',
    saveTranscript: '내보내기', viewersN: '뷰어 {n}명', 
    rename: '세션 이름 수정', clearHistory: '대화 내역 삭제', clearConfirm: '대화 내역이 모두 삭제되며 되돌릴 수 없습니다. 세션은 유지됩니다.',
    cleared: '대화 내역을 삭제했습니다.', deleteSession: '세션 삭제', deleteConfirm: "'{name}' 세션과 대화 기록이 모두 삭제되며 되돌릴 수 없습니다.", failMsg: '실패했습니다: {msg}',
  },
  en: {
    micCheckTitle: 'Check microphones', micCheckDesc: 'Speak into each microphone in turn. The active one is highlighted.', micHost: 'Host', micGuest: 'Guest', mic1: 'Mic 1', mic2: 'Mic 2', micChecked: 'Checked', micSpeak: 'Say something', 
    micCheckDescOne: 'Say something into the microphone.', micOne: 'Microphone', startOneMic: 'Start with one mic',
    pcSource: 'Audio input', srcMic: 'Microphone', srcSystem: 'PC audio', srcBoth: 'Mic + PC audio', pcMicDevice: 'Microphone device', defaultMic: 'Default microphone', pcMode: 'Mode', advanced: 'Advanced settings', overlayWin: 'Overlay window', lockedWhileRec: "You can't change this while translating. Stop first.",
    renameShort: 'Rename', sessionDeleted: 'Session deleted.',
    joinCode: 'Join code', joinAt: 'Enter it at {host}',
    openSettings: 'Open settings', speakerAria: 'Play spoken translation on this device', muteNeedRec: 'Start translating to use mute.',
    mutedMsg: 'Muted.', unmutedMsg: 'Unmuted.',
    ttsOnMsg: 'Spoken translation for participants is on.', ttsOffMsg: 'Spoken translation for participants is off.',
    speakerOnMsg: 'Spoken translation plays on this device.', speakerOffMsg: 'Spoken translation no longer plays on this device.', speakerNeedTts: 'Turn on TTS to hear it on this device.',
    secInput: 'Input', secOutput: 'Output', secSession: 'Session', inputDevice: 'Input device',
    autoSens: 'Adjust sensitivity automatically', autoSensHint: 'Sensitivity follows the background noise automatically.',
    viewers: 'Viewers', viewersCount: '{n}',
    required: 'Required: {f}',
    done: 'Done', cancel: 'Cancel', save: 'Save', back: 'Back', selected: 'Selected', delete: 'Delete',
    autoDetect: 'Auto detect', untitled: 'Untitled', netError: 'Network error',
    justNow: 'Just now', minAgo: '{n} min ago', hourAgo: '{n} h ago',
    modeOneway: 'Live translation', modeTwoway: 'Two-way interpreting',
    modeOnewayDesc: 'Translates system or microphone audio in real time.',
    modeTwowayDesc: 'Interprets between two languages, each into the other.',
    settings: 'Settings', newSession: 'New session', emptyTitle: 'No sessions yet', emptyHint: 'Tap + at the bottom right to start.',
    inputLang: 'Input language', outputLang: 'Output language', myLang: 'My language', otherLang: 'Their language', swapLangs: 'Swap languages',
    sessionName: 'Session name', nameRequired: 'Enter a session name.',
    create: 'Create', createFail: 'Could not create the session: {msg}',
    next: 'Next', nsMode: 'What kind of session?', nsSrc: 'Which language to translate?', nsTarget: 'Translate into which language?', nsMine: 'Choose your language', nsOther: 'Choose the other language', nsName: 'Name the session',
    accountSettings: 'Account settings', secLanguage: 'Language', sysLang: 'App language', nativeLang: 'Native language',
    secVoice: 'Voice', inputSens: 'Input sensitivity', inputSensHint: 'Adjust so the level bar stays in the green range while you speak.', tx1: 'Mic 1', tx2: 'Mic 2', stereoOk: '2-channel input: each microphone is recognized separately.', stereoMono: 'Both channels carry the same sound, so it is treated as one microphone. Switch the receiver to stereo mode to separate them.', stereoTry: "Speak into each microphone in turn. If the bars move separately, it's working.", version: 'Version', latestVersion: 'Up to date', updateTo: 'Update ({v})',
    ttsVoice: 'TTS voice', ttsVoiceDesc: 'Choose the voice that reads translations aloud.', female: 'Female', male: 'Male',
    previewVoice: 'Preview {v} voice', previewFail: "Couldn't play the preview.",
    secDisplay: 'Display', theme: 'Theme', themeLight: 'Light', themeDark: 'Dark', themeSystem: 'System', textSize: 'Text size', sampleGlyph: 'A',
    logout: 'Log out', logoutConfirm: 'Log out?',
    account: 'Account', accountInfo: 'Account info', username: 'Username', 
    changePassword: 'Change password', currentPassword: 'Current password', newPassword: 'New password', confirmPassword: 'Confirm new password',
    pwMismatch: 'The new passwords do not match.', pwChanged: 'Password changed. Other devices have been signed out.',
    deleteAccount: 'Delete account', deleteAccountDesc: "Your account and all sessions will be deleted and can't be restored. Enter your password to continue.",
    saved: 'Saved.', 
    
    updateTitle: 'Update available', update: 'Update', updateSize: 'Update ({mb} MB)', later: 'Later',
    downloading: 'Downloading… {p}', installHint: "Tap 'Update' on the install screen. The first time, you may need to allow installs from AirTalk.",
    downloadFail: 'Download failed. Check your connection and try again.', retry: 'Try again', reopenInstall: 'Open install screen again',
    translating: 'Translating', interpreting: 'Interpreting', 
    engineConnecting: 'Connecting to the translation service. Please wait.',
    readyHint: 'Press Start to begin translating.', speakNow: 'Start speaking and the recognized text will appear here.',
    tapHint: 'Tap the screen to show the menu.', pending: 'Translating…',
    mute: 'Mute', unmute: 'Unmute', tts: 'TTS', ttsOff: 'TTS off', start: 'Start', stop: 'Stop', end: 'End',
    endTitle: 'End translation?', endDesc: 'Everything so far is saved.',
    micPicker: 'Microphone', 
    micBuiltin: 'Built-in microphone', micBuiltinSub: 'Phone microphone', micUsb: 'USB microphone', micWired: 'Wired headset mic',
    micBt: 'Bluetooth', twoCh: '2-channel', micNeedUpdate: 'Update the app to choose the microphone.',
    
    language: 'Language', langLocked: "You can't change languages while translating. Stop first.",
    langSubOne: 'Shows speech in the output language', langSubTwo: 'Interprets each side into the other language',
    shareLink: 'Share link', shareHint: 'Scan the QR code or enter the join code to follow this session on your own phone.', copyLink: 'Copy link', copied: 'Copied', share: 'Share', generating: 'Generating…',
    saveTranscript: 'Export', viewersN: '{n} viewing', 
    rename: 'Rename session', clearHistory: 'Clear conversation', clearConfirm: "The whole conversation will be deleted and can't be restored. The session stays.",
    cleared: 'Conversation cleared.', deleteSession: 'Delete session', deleteConfirm: "'{name}' and its conversation will be deleted and can't be restored.", failMsg: 'Failed: {msg}',
  },
  ja: {
    micCheckTitle: 'マイク確認', micCheckDesc: '各マイクに順番に話してください。話している側が強調されます。', micHost: 'ホスト', micGuest: '相手', mic1: 'マイク 1', mic2: 'マイク 2', micChecked: '確認済み', micSpeak: '話してください', 
    micCheckDescOne: 'マイクに向かって話してください。', micOne: 'マイク', startOneMic: 'マイク1本で開始',
    pcSource: '音声入力', srcMic: 'マイク', srcSystem: 'PCの音', srcBoth: 'マイク + PCの音', pcMicDevice: 'マイクデバイス', defaultMic: '既定のマイク', pcMode: 'モード', advanced: '詳細設定', overlayWin: 'オーバーレイ', lockedWhileRec: '翻訳中は変更できません。停止してから変更してください。',
    renameShort: '名前を変更', sessionDeleted: 'セッションを削除しました。',
    joinCode: '参加コード', joinAt: '{host} で入力',
    openSettings: '設定を開く', speakerAria: 'この端末で翻訳音声を再生', muteNeedRec: '翻訳を開始するとミュートできます。',
    mutedMsg: 'ミュートしました。', unmutedMsg: 'ミュートを解除しました。',
    ttsOnMsg: '参加者の翻訳音声をオンにしました。', ttsOffMsg: '参加者の翻訳音声をオフにしました。',
    speakerOnMsg: 'この端末で翻訳音声を再生します。', speakerOffMsg: 'この端末では翻訳音声を再生しません。', speakerNeedTts: 'TTSをオンにするとこの端末でも聞けます。',
    secInput: '入力', secOutput: '出力', secSession: 'セッション', inputDevice: '入力デバイス',
    autoSens: '感度を自動調整', autoSensHint: '周囲の騒音に合わせて感度を自動で調整します。',
    viewers: '視聴者', viewersCount: '{n}人',
    required: '入力してください：{f}',
    done: '完了', cancel: 'キャンセル', save: '保存', back: '戻る', selected: '選択中', delete: '削除',
    autoDetect: '自動検出', untitled: '無題', netError: 'ネットワークエラー',
    justNow: 'たった今', minAgo: '{n}分前', hourAgo: '{n}時間前',
    modeOneway: 'リアルタイム翻訳', modeTwoway: '双方向通訳',
    modeOnewayDesc: 'システムまたはマイクの音声をリアルタイムで翻訳します。',
    modeTwowayDesc: '指定した2つの言語を相手の言語に通訳します。',
    settings: '設定', newSession: '新しいセッション', emptyTitle: 'セッションはまだありません', emptyHint: '右下の＋ボタンで始めましょう。',
    inputLang: '入力言語', outputLang: '出力言語', myLang: '自分の言語', otherLang: '相手の言語', swapLangs: '言語を入れ替える',
    sessionName: 'セッション名', nameRequired: 'セッション名を入力してください。',
    create: '作成', createFail: 'セッションを作成できませんでした：{msg}',
    next: '次へ', nsMode: 'どのセッションを作りますか？', nsSrc: 'どの言語を翻訳しますか？', nsTarget: '何語に翻訳しますか？', nsMine: '自分の言語を選んでください', nsOther: '相手の言語を選んでください', nsName: 'セッション名を決めてください',
    accountSettings: 'アカウント設定', secLanguage: '言語', sysLang: '表示言語', nativeLang: '母語',
    secVoice: '音声', inputSens: '入力感度', inputSensHint: '話すときにレベルバーが緑の範囲に入るよう調整してください。', tx1: 'マイク 1', tx2: 'マイク 2', stereoOk: '2チャンネル入力：2本のマイクの音声をそれぞれ認識します。', stereoMono: '2本のマイクの音声が同じため、マイク1本として認識します。受信機をステレオモードにすると分けて認識します。', stereoTry: '各マイクに順番に話してみてください。バーがそれぞれ動けば正常です。', version: 'バージョン', latestVersion: '最新バージョン', updateTo: 'アップデート（{v}）',
    ttsVoice: '読み上げ音声', ttsVoiceDesc: '翻訳文を読み上げる声を選んでください。', female: '女性', male: '男性',
    previewVoice: '{v}の声を試聴', previewFail: '試聴を再生できませんでした。',
    secDisplay: '画面', theme: 'テーマ', themeLight: 'ライト', themeDark: 'ダーク', themeSystem: 'システム', textSize: '文字サイズ', sampleGlyph: 'あ',
    logout: 'ログアウト', logoutConfirm: 'ログアウトしますか？',
    account: 'アカウント', accountInfo: 'アカウント情報', username: 'ユーザー名', 
    changePassword: 'パスワード変更', currentPassword: '現在のパスワード', newPassword: '新しいパスワード', confirmPassword: '新しいパスワード（確認）',
    pwMismatch: '新しいパスワードが一致しません。', pwChanged: 'パスワードを変更し、他の端末からログアウトしました。',
    deleteAccount: 'アカウント削除', deleteAccountDesc: 'アカウントとすべてのセッションが削除され、元に戻せません。続けるにはパスワードを入力してください。',
    saved: '保存しました。', 
    
    updateTitle: '新しいバージョンがあります', update: 'アップデート', updateSize: 'アップデート（{mb}MB）', later: '後で',
    downloading: 'ダウンロード中… {p}', installHint: 'インストール画面で「アップデート」を押してください。初回は「AirTalkからのインストールを許可」が必要な場合があります。',
    downloadFail: 'ダウンロードできませんでした。ネットワークを確認してもう一度お試しください。', retry: '再試行', reopenInstall: 'インストール画面をもう一度開く',
    translating: '翻訳中', interpreting: '通訳中', 
    engineConnecting: '翻訳サービスに接続しています。しばらくお待ちください。',
    readyHint: '開始ボタンを押して翻訳を始めてください。', speakNow: '話すと認識された内容が表示されます。',
    tapHint: '画面をタップするとメニューが表示されます。', pending: '翻訳中…',
    mute: 'ミュート', unmute: 'ミュート解除', tts: 'TTS', ttsOff: 'TTS オフ', start: '開始', stop: '停止', end: '終了',
    endTitle: '翻訳を終了しますか？', endDesc: 'ここまでの内容は保存されます。',
    micPicker: 'マイク選択', 
    micBuiltin: '内蔵マイク', micBuiltinSub: 'スマホのマイク', micUsb: 'USBマイク', micWired: '有線イヤホンマイク',
    micBt: 'Bluetooth', twoCh: '2チャンネル', micNeedUpdate: 'アプリを更新するとマイクを選べます。',
    
    language: '言語', langLocked: '翻訳中は言語を変更できません。停止してから変更してください。',
    langSubOne: '話した内容を出力言語で表示します', langSubTwo: 'お互いの言葉を相手の言語に通訳します',
    shareLink: 'リンク共有', shareHint: 'QRコードを読み取るか参加コードを入力すると、このセッションの翻訳を各自のスマホで見られます。', copyLink: 'リンクをコピー', copied: 'コピーしました', share: '共有', generating: '生成中…',
    saveTranscript: 'エクスポート', viewersN: '視聴 {n}人', 
    rename: 'セッション名を変更', clearHistory: '会話履歴を削除', clearConfirm: '会話履歴がすべて削除され、元に戻せません。セッションは残ります。',
    cleared: '会話履歴を削除しました。', deleteSession: 'セッションを削除', deleteConfirm: '「{name}」と会話履歴がすべて削除され、元に戻せません。', failMsg: '失敗しました：{msg}',
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
