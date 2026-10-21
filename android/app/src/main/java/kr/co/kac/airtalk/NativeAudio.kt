package kr.co.kac.airtalk

import android.Manifest
import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.AudioRouting
import android.media.MediaRecorder
import android.media.audiofx.AcousticEchoCanceler
import android.media.audiofx.AudioEffect
import android.media.audiofx.AutomaticGainControl
import android.media.audiofx.NoiseSuppressor
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.widget.Toast
import org.json.JSONArray
import org.json.JSONObject

/**
 * 웹 페이지에 `window.AndroidAudio` 로 노출되는 네이티브 마이크 브리지.
 *
 * 브라우저 getUserMedia 와 달리 AGC(자동 게인)가 확실히 꺼진 원음을 24kHz PCM16 으로 공급한다:
 *  - 소스 = VOICE_RECOGNITION(안드로이드 CDD 상 AGC 미적용) + AutomaticGainControl 명시 해제
 *  - AEC(이 기기가 재생하는 TTS 를 마이크에서 제거)·NS(정상 소음 억제)는 지원 기기만 부착
 *  - 소프트웨어 게인(0.1~8.0×)으로 기기별 하드웨어 감도 편차를 보정(앱 관리 메뉴에서 조절)
 *  - 외부 마이크 우선: USB-C 무선 수신기 등이 꽂혀 있으면 그쪽으로 명시 라우팅하고,
 *    번역 중 꽂거나 뽑아도 캡처를 끊지 않고 입력만 바꾼다(전환 시 토스트로 알림)
 *  - 입력 직접 선택(1.4.0~): 웹 마이크 시트가 inputs()/setInput(id) 로 내장·USB·유선·블루투스 중 고른다(저장·유지).
 *    고른 장치가 빠지면 자동 선택으로 돌고, 다시 연결되면 그 장치로 돌아간다. 블루투스는 캡처하는 동안만 SCO 링크를 연다.
 *
 * 청크는 약 100ms 단위 base64 로 `window.__kacNA(b64)` 콜백에 전달(≈6.4KB/회).
 * 게이트·VAD 판정은 웹 쪽(기존 적응형 게이트 로직)이 그대로 수행한다 — 이 브리지는
 * '증폭되지 않은 진짜 음량'을 전달하는 것까지만 책임진다.
 */
class NativeAudio(private val activity: Activity, private val webView: WebView) {

    // 이름이 gain 이면 자동 생성 getGain()/setGain() 이 아래 브리지 함수와 JVM 시그니처가 겹쳐 컴파일 실패
    @Volatile
    var inputGain: Float = 1.0f
        set(value) {
            field = value.coerceIn(0.1f, 8.0f)
        }

    /** 열려 있는 캡처 하나 — 효과는 해당 AudioRecord 세션에 묶여 있으므로 함께 해제한다 */
    private class Capture(val record: AudioRecord, val rate: Int, val effects: List<AudioEffect>, val channels: Int)

    /** 스테레오 캡처 요청(양방향 통역 2채널) — USB 수신기가 2채널을 주면 좌우를 따로 넘긴다(재개방 때도 유지) */
    @Volatile
    private var stereoWanted = false

    @Volatile
    private var running = false
    private var thread: Thread? = null

    /** stop() 이 늦게 끝난 이전 스레드가 새 캡처와 동시에 돌지 않게 하는 세대 번호 */
    @Volatile
    private var gen = 0

    /** 현재 캡처(장치 연결·분리 시 선호 입력을 바꾸는 데 사용) */
    @Volatile
    private var cur: Capture? = null

    @Volatile
    private var stat: String = "{}"

    /** 캡처 스레드에 '지금 캡처를 닫고 다시 열라'고 알림(입력 변경으로 채널 수가 바뀜·블루투스 링크가 늦게 섬) */
    @Volatile
    private var reopenWanted = false

    private val am by lazy { activity.getSystemService(Context.AUDIO_SERVICE) as AudioManager }
    private val prefs by lazy { activity.getSharedPreferences("airtalk", Context.MODE_PRIVATE) }
    private val main = Handler(Looper.getMainLooper())
    private var lastNotified: String? = null // main 스레드 전용

    /** 선택 목록의 한 항목 — 안드로이드가 같은 장치를 여러 번 내놓는 것(USB_DEVICE·USB_HEADSET, 주소별 내장 마이크)을 합친 대표 */
    private class Choice(val key: String, val kind: String, var dev: AudioDeviceInfo, var channels: Int)

    /**
     * 입력 결정·블루투스 링크 상태 보호 — JS 브리지·main(장치 콜백)·캡처 스레드가 함께 건드린다.
     * start/stop 의 this 잠금 안에서 잡는 것은 되지만, 이 잠금을 쥔 채 this 를 기다리면 안 된다.
     */
    private val routeLock = Any()
    private var linkedOut: AudioDeviceInfo? = null // API 31+: setCommunicationDevice 로 잡은 블루투스 출력(= SCO 링크)
    private var legacySco = false                  // API 30 이하: startBluetoothSco 로 켠 상태
    private var scoReceiver: BroadcastReceiver? = null
    private var btFailKey: String? = null          // 같은 블루투스 실패 안내를 반복하지 않게

    private val deviceCallback = object : AudioDeviceCallback() {
        override fun onAudioDevicesAdded(addedDevices: Array<out AudioDeviceInfo>?) = reroute()
        override fun onAudioDevicesRemoved(removedDevices: Array<out AudioDeviceInfo>?) = reroute()
    }

    private val routingListener: AudioRouting.OnRoutingChangedListener = object : AudioRouting.OnRoutingChangedListener {
        override fun onRoutingChanged(router: AudioRouting) {
            notifyInput(router.routedDevice)
        }
    }

    /** 페이지가 브리지 존재+권한을 한 번에 확인할 때 사용 */
    @JavascriptInterface
    fun isAvailable(): Boolean = true

    @Synchronized
    @JavascriptInterface
    fun start(): Boolean = begin(false) > 0

    /**
     * 스테레오 캡처 시작 — 반환: 2=스테레오(좌우를 window.__kacNA2 로 인터리브 전달), 1=모노(장치가 2채널을 못 줌,
     * window.__kacNA), 0=실패. 웹은 좌우가 진짜로 다른지 소리로 다시 판별한다(모노 모드 수신기는 같은 소리를 복사해 보냄).
     */
    @Synchronized
    @JavascriptInterface
    fun startStereo(): Int = begin(true)

    private fun begin(stereo: Boolean): Int {
        if (running) return cur?.channels ?: 1
        stereoWanted = stereo
        if (activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            // 다음 시도가 성공하도록 권한 요청을 올려 두고 이번엔 실패를 알린다(페이지가 폴백/안내)
            activity.runOnUiThread {
                activity.requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), 1)
            }
            return 0
        }
        reopenWanted = false
        synchronized(routeLock) { btFailKey = null }
        val myGen = ++gen // 먼저 올려서 늦게 끝나는 이전 스레드가 아래 running=true 를 보고 살아나지 않게
        running = true // open() 이 블루투스 링크를 잡으려면 캡처 중이어야 한다(실패하면 되돌림)
        val c = open()
        if (c == null) {
            running = false
            synchronized(routeLock) { unlinkBt() }
            return 0
        }
        try {
            am.registerAudioDeviceCallback(deviceCallback, main)
        } catch (_: Exception) {
        }
        thread = Thread({ loop(c, myGen) }, "airtalk-audio").apply {
            isDaemon = true
            start()
        }
        return c.channels
    }

    /** source·채널 구성으로 AudioRecord 를 만든다(지원 샘플레이트를 차례로 시도). 실패 시 null */
    private fun create(source: Int, mask: Int, wantCh: Int): Pair<AudioRecord, Int>? {
        for (r in intArrayOf(48000, 44100, 24000, 16000)) {
            val minBuf = AudioRecord.getMinBufferSize(r, mask, AudioFormat.ENCODING_PCM_16BIT)
            if (minBuf <= 0) continue
            try {
                val a = AudioRecord(source, r, mask, AudioFormat.ENCODING_PCM_16BIT, maxOf(minBuf * 2, r / 5 * 2 * wantCh)) // 최소 200ms 버퍼
                if (a.state == AudioRecord.STATE_INITIALIZED && a.channelCount == wantCh) return a to r
                a.release()
            } catch (_: Exception) {
            }
        }
        return null
    }

    /** AudioRecord 생성 → 입력 장치 지정 → 효과 부착 → 녹음 시작. 실패 시 null(자원 정리 완료). */
    private fun open(): Capture? {
        // 고른 입력(없으면 자동) — 블루투스면 여기서 SCO 링크까지 연다
        val dev = synchronized(routeLock) { resolveTarget() }
        // 스테레오: USB 장치이고 2채널을 지원할 때만(내장·블루투스를 고르면 항상 1채널)
        val dev2ch = stereoCapable(dev)
        var made: Pair<AudioRecord, Int>? = null
        var channels = 1
        if (stereoWanted && dev2ch) {
            made = create(MediaRecorder.AudioSource.VOICE_RECOGNITION, AudioFormat.CHANNEL_IN_STEREO, 2)
                ?: create(MediaRecorder.AudioSource.MIC, AudioFormat.CHANNEL_IN_STEREO, 2)
            if (made != null) channels = 2
        }
        if (made == null) made = create(MediaRecorder.AudioSource.VOICE_RECOGNITION, AudioFormat.CHANNEL_IN_MONO, 1)
        val got = made ?: return null
        // 이번 캡처에서 한 번이라도 1채널로 열면 이후 재개방·입력 변경도 1채널 — 웹은 모노 프레임(또는 startStereo()=1)을
        // 받으면 이번 세션을 1채널로 돌리므로, 다시 2채널을 보내면 왼쪽만 쓰여 상대(오른쪽) 소리를 잃는다
        if (channels == 1) stereoWanted = false
        val record = got.first
        val rate = got.second
        if (dev != null) {
            try {
                record.setPreferredDevice(dev)
            } catch (_: Exception) {
            }
        }

        val effects = mutableListOf<AudioEffect>()
        var aec = false
        var ns = false
        try {
            AutomaticGainControl.create(record.audioSessionId)?.let {
                it.enabled = false
                effects.add(it)
            }
        } catch (_: Exception) {
        }
        try {
            AcousticEchoCanceler.create(record.audioSessionId)?.let {
                it.enabled = true
                effects.add(it)
                aec = true
            }
        } catch (_: Exception) {
        }
        try {
            NoiseSuppressor.create(record.audioSessionId)?.let {
                it.enabled = true
                effects.add(it)
                ns = true
            }
        } catch (_: Exception) {
        }
        val c = Capture(record, rate, effects, channels)
        try {
            record.addOnRoutingChangedListener(routingListener, main)
        } catch (_: Exception) {
        }
        try {
            record.startRecording()
        } catch (_: Exception) {
            close(c)
            return null
        }
        if (record.recordingState != AudioRecord.RECORDSTATE_RECORDING) {
            close(c)
            return null
        }
        stat = JSONObject()
            .put("source", "voice_recognition")
            .put("rate", rate)
            .put("aec", aec)
            .put("ns", ns)
            .put("preferred", describe(dev))
            .put("channels", channels)
            .put("select", selKey() ?: "auto")
            .toString()
        Log.i(TAG, "capture start rate=$rate aec=$aec ns=$ns gain=$inputGain preferred=${describe(dev)}")
        cur = c
        notifyInput(record.routedDevice)
        return c
    }

    private fun loop(first: Capture, myGen: Int) {
        fun alive() = running && gen == myGen
        var c = first
        var inBuf = ShortArray(c.rate / 10 * c.channels) // 100ms(스테레오는 좌우 인터리브)
        while (alive()) {
            var off = 0
            var dead = false
            while (off < inBuf.size && alive()) {
                val n = c.record.read(inBuf, off, inBuf.size - off)
                if (n <= 0) {
                    if (n < 0) dead = true
                    break
                }
                off += n
            }
            if (!alive()) break
            if (!dead && off > 0) {
                val stereo = c.channels == 2
                val out = if (stereo) to24kStereo(inBuf, off - (off % 2), c.rate) else to24k(inBuf, off, c.rate)
                val bytes = ByteArray(out.size * 2)
                var j = 0
                for (s in out) {
                    val v = s.toInt()
                    bytes[j++] = (v and 0xff).toByte()
                    bytes[j++] = ((v shr 8) and 0xff).toByte()
                }
                val b64 = Base64.encodeToString(bytes, Base64.NO_WRAP)
                // base64 문자셋([A-Za-z0-9+/=])은 JS 문자열 리터럴에 그대로 안전
                val fn = if (stereo) "__kacNA2" else "__kacNA"
                webView.post {
                    webView.evaluateJavascript("window.$fn&&window.$fn(\"$b64\")", null)
                }
            }
            if (dead || reopenWanted) {
                // dead: 장치 분리(USB 수신기 뽑힘 등)로 AudioRecord 가 죽어도 캡처를 끝내지 않고 다시 연다 —
                // 웹은 네이티브 오류를 알 수 없어, 여기서 멈추면 '번역 중'인데 소리만 끊긴 상태가 된다.
                // reopenWanted: 입력 선택이 바뀌어 채널 수가 달라졌거나(2채널→내장·블루투스) 블루투스 링크가 늦게 섰다
                Log.w(TAG, if (dead) "capture read error — reopening" else "capture reopen — input changed")
                reopenWanted = false
                close(c)
                var next: Capture? = null
                var wait = dead // 입력 변경은 바로 다시 열고, 실패하면 그때부터 300ms 간격
                while (next == null && alive()) {
                    if (wait) {
                        try {
                            Thread.sleep(300)
                        } catch (_: InterruptedException) {
                            break
                        }
                    }
                    wait = true
                    next = open()
                }
                if (next == null) return // 이미 정리됨(stop 됐거나 중단)
                if (!alive()) {
                    close(next)
                    return
                }
                c = next
                if (inBuf.size != c.rate / 10 * c.channels) inBuf = ShortArray(c.rate / 10 * c.channels)
            }
        }
        close(c)
        Log.i(TAG, "capture stop")
    }

    private fun close(c: Capture) {
        if (cur === c) cur = null
        try {
            c.record.removeOnRoutingChangedListener(routingListener)
        } catch (_: Exception) {
        }
        try {
            c.record.stop()
        } catch (_: Exception) {
        }
        for (e in c.effects) {
            try {
                e.release()
            } catch (_: Exception) {
            }
        }
        try {
            c.record.release()
        } catch (_: Exception) {
        }
    }

    private fun inputDevices(): Array<AudioDeviceInfo> = try {
        am.getDevices(AudioManager.GET_DEVICES_INPUTS)
    } catch (_: Exception) {
        emptyArray()
    }

    /** 선택 목록의 종류 — null 이면 목록에 넣지 않는 입력(전화 회선·FM 튜너·내부 루프백 등) */
    private fun kindOf(d: AudioDeviceInfo): String? = when (d.type) {
        AudioDeviceInfo.TYPE_BUILTIN_MIC -> "builtin"
        AudioDeviceInfo.TYPE_USB_DEVICE, AudioDeviceInfo.TYPE_USB_HEADSET -> "usb"
        AudioDeviceInfo.TYPE_WIRED_HEADSET -> "wired"
        AudioDeviceInfo.TYPE_BLUETOOTH_SCO -> "bluetooth"
        AudioDeviceInfo.TYPE_BLE_HEADSET -> if (Build.VERSION.SDK_INT >= 31) "bluetooth" else null // LE 오디오 헤드셋
        else -> null
    }

    private fun nameOf(d: AudioDeviceInfo): String = d.productName?.toString()?.trim().orEmpty()

    /**
     * 저장용 키 — AudioDeviceInfo.id 는 다시 꽂거나 재부팅하면 바뀌므로 선택은 이 키로 저장한다.
     * 내장·유선은 종류만(내장 마이크는 주소별로 여러 개 잡혀도 하나), USB·블루투스는 종류+제품명.
     */
    private fun keyOf(d: AudioDeviceInfo): String? {
        val kind = kindOf(d) ?: return null
        return if (kind == "usb" || kind == "bluetooth") "$kind:${nameOf(d)}" else kind
    }

    private fun isBt(d: AudioDeviceInfo?): Boolean = d != null && kindOf(d) == "bluetooth"

    /** 2채널(좌우 따로) 캡처를 할 입력 — USB 장치만(내장 마이크 2개짜리 폰 스테레오는 화자 분리가 아니므로 제외) */
    private fun stereoCapable(d: AudioDeviceInfo?): Boolean =
        d != null && (d.type == AudioDeviceInfo.TYPE_USB_HEADSET || d.type == AudioDeviceInfo.TYPE_USB_DEVICE) &&
            (d.channelCounts.isEmpty() || d.channelCounts.contains(2))

    /** 주 내장 마이크(AOSP 구성의 address "bottom") — 내장 마이크가 여러 개 잡힐 때 대표로 쓴다 */
    private fun isMainMic(d: AudioDeviceInfo): Boolean = Build.VERSION.SDK_INT >= 28 && d.address == "bottom"

    /** 선택 가능한 입력(키 기준 중복 제거, 내장 → USB → 유선 → 블루투스 순) */
    private fun choices(ins: Array<AudioDeviceInfo>): List<Choice> {
        val m = LinkedHashMap<String, Choice>()
        for (d in ins) {
            val kind = kindOf(d) ?: continue
            val key = keyOf(d) ?: continue
            val ch = d.channelCounts.maxOrNull() ?: 0
            val c = m[key]
            if (c == null) {
                m[key] = Choice(key, kind, d, ch)
            } else {
                if (ch > c.channels) c.channels = ch
                if (kind == "builtin" && isMainMic(d) && !isMainMic(c.dev)) c.dev = d
                if (kind == "usb" && stereoCapable(d) && !stereoCapable(c.dev)) c.dev = d
            }
        }
        return m.values.sortedBy { KIND_ORDER.indexOf(it.kind) }
    }

    /** 저장된 입력 선택 키 — null = 자동 */
    private fun selKey(): String? = try {
        prefs.getString(PREF_INPUT, null)?.takeIf { it.isNotEmpty() }
    } catch (_: Exception) {
        null
    }

    private fun savedLabel(): String? = try {
        prefs.getString(PREF_INPUT_LABEL, null)?.takeIf { it.isNotEmpty() }
    } catch (_: Exception) {
        null
    }

    /**
     * 자동 선택(1.3.0 까지의 동작) — 외부 마이크 우선: USB(USB-C 무선 수신기·USB 마이크) → 유선 이어폰 마이크 →
     * 없으면 null(OS 기본 = 내장 마이크). 블루투스는 통화용 협대역(SCO)이라 자동으로는 고르지 않는다(직접 고를 때만).
     */
    private fun autoInput(ins: Array<AudioDeviceInfo>): AudioDeviceInfo? =
        ins.firstOrNull { it.type == AudioDeviceInfo.TYPE_USB_HEADSET || it.type == AudioDeviceInfo.TYPE_USB_DEVICE }
            ?: ins.firstOrNull { it.type == AudioDeviceInfo.TYPE_WIRED_HEADSET }

    /**
     * 쓸 입력: 사용자가 고른 장치가 지금 연결돼 있으면 그 장치, 아니면 자동 선택.
     * 고른 장치가 빠져도 선택은 지우지 않는다 — 다시 연결되면 그 장치로 돌아간다. (블루투스 링크는 열지 않음)
     */
    private fun pickInput(ins: Array<AudioDeviceInfo> = inputDevices()): AudioDeviceInfo? {
        val want = selKey()
        if (want != null) choices(ins).firstOrNull { it.key == want }?.let { return it.dev }
        return autoInput(ins)
    }

    /**
     * 캡처에 쓸 입력을 정한다(routeLock 안에서 호출). 블루투스면 SCO 링크를 열고(캡처 중일 때만),
     * 못 열면 이번엔 자동 선택으로 대신한다. 블루투스가 아니면 잡아 둔 링크를 놓는다.
     */
    private fun resolveTarget(): AudioDeviceInfo? {
        val ins = inputDevices()
        var d = pickInput(ins)
        if (d != null && isBt(d) && running && !linkBt(d)) {
            warnBtFail(d)
            d = autoInput(ins)
        }
        if (!isBt(d)) unlinkBt()
        return d
    }

    /** 블루투스 입력이 실제로 소리를 받도록 SCO 링크를 연다(routeLock 안). 이미 열려 있으면 그대로 true */
    private fun linkBt(input: AudioDeviceInfo): Boolean {
        if (Build.VERSION.SDK_INT >= 31) {
            val out = commDeviceFor(input) ?: return false
            if (linkedOut?.id == out.id) return true
            val ok = try {
                am.setCommunicationDevice(out)
            } catch (_: Exception) {
                false
            }
            if (!ok) return false
            linkedOut = out
            Log.i(TAG, "bluetooth link: communication device ${out.type}/${nameOf(out)}")
            return true
        }
        return legacyScoOn()
    }

    /** API 31+: 블루투스 입력과 짝인 통신용 출력 장치(SCO 입력 → SCO 출력, LE 오디오 → LE 오디오) — 주소 → 이름 → 첫 번째 */
    private fun commDeviceFor(input: AudioDeviceInfo): AudioDeviceInfo? {
        if (Build.VERSION.SDK_INT < 31) return null
        val type = if (input.type == AudioDeviceInfo.TYPE_BLE_HEADSET) AudioDeviceInfo.TYPE_BLE_HEADSET else AudioDeviceInfo.TYPE_BLUETOOTH_SCO
        val list = try {
            am.availableCommunicationDevices.filter { it.type == type }
        } catch (_: Exception) {
            return null
        }
        val addr = input.address
        val name = nameOf(input)
        return list.firstOrNull { addr.isNotEmpty() && it.address == addr }
            ?: list.firstOrNull { name.isNotEmpty() && nameOf(it) == name }
            ?: list.firstOrNull()
    }

    /** SCO 링크 해제(routeLock 안) — 블루투스에서 다른 입력으로 바꿀 때·정지·종료 시. 잡은 게 없으면 아무것도 안 함 */
    private fun unlinkBt() {
        if (Build.VERSION.SDK_INT >= 31 && linkedOut != null) {
            linkedOut = null
            try {
                am.clearCommunicationDevice()
            } catch (_: Exception) {
            }
            Log.i(TAG, "bluetooth link released")
        }
        if (legacySco) legacyScoOff()
    }

    /** API 30 이하: startBluetoothSco + setBluetoothScoOn. 연결은 비동기라 붙는 순간 캡처를 다시 연다(watchSco) */
    @Suppress("DEPRECATION")
    private fun legacyScoOn(): Boolean {
        if (legacySco) return true
        return try {
            if (!am.isBluetoothScoAvailableOffCall) return false
            am.startBluetoothSco()
            legacySco = true
            am.isBluetoothScoOn = true
            watchSco()
            Log.i(TAG, "bluetooth link: startBluetoothSco")
            true
        } catch (_: Exception) {
            false
        }
    }

    @Suppress("DEPRECATION")
    private fun legacyScoOff() {
        legacySco = false
        unwatchSco()
        try {
            am.isBluetoothScoOn = false
        } catch (_: Exception) {
        }
        try {
            am.stopBluetoothSco()
        } catch (_: Exception) {
        }
        Log.i(TAG, "bluetooth link released (legacy)")
    }

    /**
     * API 30 이하 전용: SCO 링크가 실제로 선 순간(보통 1초 안팎 뒤) 캡처를 한 번 다시 열어, 링크 전에 연 입력이
     * 무음으로 남지 않게 한다. (API 31+ 는 녹음이 활성일 때 시스템이 SCO 를 올리고 내리므로 다시 열면 링크가
     * 내려갔다 올라오며 반복될 수 있어 쓰지 않는다)
     */
    private fun watchSco() {
        if (Build.VERSION.SDK_INT >= 31 || scoReceiver != null) return
        val r = object : BroadcastReceiver() {
            override fun onReceive(context: Context?, intent: Intent?) {
                if (isInitialStickyBroadcast) return // 등록 즉시 오는 지난 상태(스티키)는 무시
                val st = intent?.getIntExtra(AudioManager.EXTRA_SCO_AUDIO_STATE, AudioManager.SCO_AUDIO_STATE_ERROR) ?: return
                if (st == AudioManager.SCO_AUDIO_STATE_CONNECTED && cur != null) {
                    Log.i(TAG, "bluetooth SCO connected — reopening capture")
                    reopenWanted = true
                }
            }
        }
        try {
            activity.registerReceiver(r, IntentFilter(AudioManager.ACTION_SCO_AUDIO_STATE_UPDATED))
            scoReceiver = r
        } catch (_: Exception) {
        }
    }

    private fun unwatchSco() {
        val r = scoReceiver ?: return
        scoReceiver = null
        try {
            activity.unregisterReceiver(r)
        } catch (_: Exception) {
        }
    }

    /** 블루투스 링크를 못 열어 다른 입력으로 대신할 때 한 번 알림(routeLock 안) */
    private fun warnBtFail(d: AudioDeviceInfo) {
        val k = keyOf(d)
        if (k == btFailKey) return
        btFailKey = k
        Log.w(TAG, "bluetooth link failed: ${describe(d)}")
        main.post {
            Toast.makeText(activity, "블루투스 마이크를 연결하지 못해 다른 마이크로 듣습니다", Toast.LENGTH_LONG).show()
        }
    }

    /**
     * 장치 연결·분리·입력 선택 변경 → 진행 중인 캡처의 선호 입력만 교체(AudioRecord 가 끊김 없이 재라우팅).
     * 2채널로 듣는 중인데 새 입력이 2채널 USB 가 아니면(내장·블루투스 선택, 수신기 분리) 1채널로 다시 연다.
     */
    private fun reroute() {
        synchronized(routeLock) {
            val c = cur ?: return
            val d = resolveTarget()
            if (c.channels == 2 && !stereoCapable(d)) {
                reopenWanted = true
                return
            }
            try {
                c.record.setPreferredDevice(d)
            } catch (_: Exception) {
            }
        }
    }

    /** 실제 입력 장치가 바뀌면 토스트로 알린다 — 내장 마이크로 처음 시작할 때는 조용히 */
    private fun notifyInput(d: AudioDeviceInfo?) {
        if (d == null) return // 라우팅 확정 전 — 확정되면 리스너로 다시 온다
        val label = describe(d)
        main.post {
            if (label == lastNotified) return@post
            val first = lastNotified == null
            lastNotified = label
            if (first && d.type == AudioDeviceInfo.TYPE_BUILTIN_MIC) return@post
            Toast.makeText(activity, "마이크 입력: $label", Toast.LENGTH_SHORT).show()
        }
    }

    private fun describe(d: AudioDeviceInfo?): String {
        if (d == null) return "기본 입력"
        val kind = when (d.type) {
            AudioDeviceInfo.TYPE_BUILTIN_MIC -> return "내장 마이크"
            AudioDeviceInfo.TYPE_USB_HEADSET, AudioDeviceInfo.TYPE_USB_DEVICE -> "USB 마이크"
            AudioDeviceInfo.TYPE_WIRED_HEADSET -> "유선 이어폰 마이크"
            AudioDeviceInfo.TYPE_BLUETOOTH_SCO, AudioDeviceInfo.TYPE_BLE_HEADSET -> "블루투스 마이크"
            else -> "입력 장치(${d.type})"
        }
        val name = d.productName?.toString()?.trim().orEmpty()
        return if (name.isEmpty()) kind else "$kind ($name)"
    }

    /** 웹 화면 표시용(폰 화면의 마이크 칩): 캡처 중이면 실제 입력, 대기 중이면 시작하면 쓸 입력 */
    @JavascriptInterface
    fun inputLabel(): String {
        val c = cur
        if (c != null) {
            val d = try {
                c.record.routedDevice
            } catch (_: Exception) {
                null
            }
            if (d != null) return describe(d)
        }
        return pickInput()?.let { describe(it) } ?: "내장 마이크"
    }

    /** 앱 정보용: 캡처 중이면 실제로 쓰는 입력, 대기 중이면 다음 시작 때 고를 입력 + 선택 상태 */
    fun inputStatus(): String {
        val c = cur
        val base = if (c != null) {
            "사용 중 — ${describe(c.record.routedDevice)}"
        } else {
            "대기 — 시작하면 ${pickInput()?.let { describe(it) } ?: "내장 마이크"}"
        }
        val want = selKey() ?: return "$base (자동 선택)"
        val present = choices(inputDevices()).any { it.key == want }
        return if (present) "$base (직접 선택)" else "$base (선택한 ${savedLabel() ?: "마이크"} 없음 → 자동)"
    }

    /**
     * 마이크 선택 시트용 입력 목록(JSON 배열 문자열). 첫 항목은 항상 id 0 '자동'(1.3.0 까지의 자동 선택).
     *   {id, kind:"auto"|"builtin"|"usb"|"wired"|"bluetooth", label, selected, active?, channels?, missing?}
     *  - id: 이번 연결 동안의 장치 번호(다시 꽂으면 바뀐다) — 고를 때 setInput(id) 로 그대로 넘긴다
     *  - selected: 저장된 선택(자동이면 id 0). 고른 장치가 지금 없으면 어느 항목도 selected 가 아니고,
     *    '자동' 항목의 missing 에 그 장치 이름이 실린다(그동안 자동으로 동작, 다시 연결되면 그 장치로)
     *  - active: 지금 실제로 쓰는 입력(캡처 중이 아니면 시작하면 쓸 입력) — 장치 항목에만
     *  - channels: 장치가 알려 준 최대 채널 수(모르면 생략). USB 스테레오 수신기는 2
     */
    @JavascriptInterface
    fun inputs(): String {
        val ins = inputDevices()
        val list = choices(ins)
        val want = selKey()
        val c = cur
        val routed = if (c == null) {
            null
        } else {
            try {
                c.record.routedDevice
            } catch (_: Exception) {
                null
            }
        }
        val activeKey = (routed ?: pickInput(ins))?.let { keyOf(it) } ?: "builtin"
        val arr = JSONArray()
        val auto = JSONObject()
            .put("id", 0)
            .put("kind", "auto")
            .put("label", "자동")
            .put("selected", want == null)
        if (want != null && list.none { it.key == want }) auto.put("missing", savedLabel() ?: "선택한 마이크")
        arr.put(auto)
        for (e in list) {
            val o = JSONObject()
                .put("id", e.dev.id)
                .put("kind", e.kind)
                .put("label", describe(e.dev))
                .put("selected", e.key == want)
                .put("active", e.key == activeKey)
            if (e.channels > 0) o.put("channels", e.channels)
            arr.put(o)
        }
        return arr.toString()
    }

    /**
     * 마이크 입력 선택 — id 는 inputs() 의 id, 0 = 자동. 기기에 저장돼 앱을 다시 켜도 유지된다.
     * 캡처 중이면 바로 그 입력으로 바꾼다(2채널로 듣는 중에 내장·블루투스를 고르면 1채널로 다시 연다).
     * 블루투스를 고르면 캡처하는 동안 SCO 링크를 연다(협대역 — 화면이 미리 안내). 링크를 못 열면 자동 선택으로 대신한다.
     * 반환: 저장했으면 true, 모르는 id(그 사이 장치가 빠짐)면 false.
     */
    @JavascriptInterface
    fun setInput(id: Int): Boolean {
        val ed = prefs.edit()
        if (id == 0) {
            ed.remove(PREF_INPUT).remove(PREF_INPUT_LABEL)
        } else {
            val d = inputDevices().firstOrNull { it.id == id } ?: return false
            val k = keyOf(d) ?: return false
            ed.putString(PREF_INPUT, k).putString(PREF_INPUT_LABEL, describe(d))
        }
        ed.apply() // 메모리에는 즉시 반영(디스크 쓰기만 비동기)
        Log.i(TAG, "input selected: ${selKey() ?: "auto"}")
        synchronized(routeLock) { btFailKey = null }
        reroute() // 캡처 중이 아니면 아무것도 안 함 — 다음 시작 때 이 선택으로 연다
        return true
    }

    /** 스테레오(좌우 인터리브) → 24kHz 인터리브 + 소프트웨어 게인 — 채널별 선형 보간 */
    private fun to24kStereo(buf: ShortArray, len: Int, rate: Int): ShortArray {
        val frames = len / 2
        if (frames <= 0) return ShortArray(0)
        val g = inputGain
        val outFrames = if (rate == 24000) frames else (frames.toLong() * 24000L / rate).toInt()
        val out = ShortArray(outFrames * 2)
        val step = rate.toDouble() / 24000.0
        for (i in 0 until outFrames) {
            val pos = i * step
            val i0 = pos.toInt().coerceAtMost(frames - 1)
            val i1 = if (i0 + 1 < frames) i0 + 1 else frames - 1
            val frac = pos - i0
            for (ch in 0..1) {
                val v = (buf[i0 * 2 + ch] * (1 - frac) + buf[i1 * 2 + ch] * frac) * g
                out[i * 2 + ch] = v.toInt().coerceIn(-32768, 32767).toShort()
            }
        }
        return out
    }

    /** 선형 보간 리샘플 → 24kHz(서버·soniox 파이프라인 규격) + 소프트웨어 게인(클리핑 클램프) */
    private fun to24k(buf: ShortArray, len: Int, rate: Int): ShortArray {
        val g = inputGain
        if (rate == 24000) {
            val out = ShortArray(len)
            for (i in 0 until len) {
                out[i] = (buf[i] * g).toInt().coerceIn(-32768, 32767).toShort()
            }
            return out
        }
        val outLen = (len.toLong() * 24000L / rate).toInt()
        val out = ShortArray(outLen)
        val step = rate.toDouble() / 24000.0
        for (i in 0 until outLen) {
            val pos = i * step
            val i0 = pos.toInt()
            val i1 = if (i0 + 1 < len) i0 + 1 else len - 1
            val frac = pos - i0
            val v = (buf[i0] * (1 - frac) + buf[i1] * frac) * g
            out[i] = v.toInt().coerceIn(-32768, 32767).toShort()
        }
        return out
    }

    @Synchronized
    @JavascriptInterface
    fun stop() {
        val was = running || thread != null
        running = false
        reopenWanted = false
        // 블루투스 SCO 링크는 캡처하는 동안만 — running=false 뒤에 놓아야 늦게 도는 open()/reroute() 가 다시 잡지 않는다
        synchronized(routeLock) { unlinkBt() }
        if (!was) return
        try {
            am.unregisterAudioDeviceCallback(deviceCallback)
        } catch (_: Exception) {
        }
        thread?.let {
            try {
                it.join(500)
            } catch (_: Exception) {
            }
        }
        thread = null
    }

    @JavascriptInterface
    fun setGain(v: Float) {
        inputGain = v
    }

    @JavascriptInterface
    fun getGain(): Float = inputGain

    /** 마지막 캡처 구성(JSON): {source, rate, aec, ns, preferred, channels, select} — 앱 정보·현장 진단용 */
    @JavascriptInterface
    fun info(): String = stat

    /** 기기 미디어 볼륨(TTS 재생 크기) 0.0~1.0 — 웹은 기기 마스터 볼륨을 못 만지므로 브리지로 제공 */
    @JavascriptInterface
    fun setMediaVolume(v: Float) {
        try {
            val max = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
            am.setStreamVolume(AudioManager.STREAM_MUSIC, (v.coerceIn(0f, 1f) * max + 0.5f).toInt(), 0)
        } catch (_: Exception) {
        }
    }

    @JavascriptInterface
    fun getMediaVolume(): Float = try {
        am.getStreamVolume(AudioManager.STREAM_MUSIC).toFloat() / am.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
    } catch (_: Exception) {
        1f
    }

    companion object {
        private const val TAG = "AirTalkAudio"
        private const val PREF_INPUT = "micInput"            // 선택한 입력의 저장용 키(keyOf), 없으면 자동
        private const val PREF_INPUT_LABEL = "micInputLabel" // 그 장치 이름(빠져 있을 때 안내용)
        private val KIND_ORDER = listOf("builtin", "usb", "wired", "bluetooth")
    }
}
