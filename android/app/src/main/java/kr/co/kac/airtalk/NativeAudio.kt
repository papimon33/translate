package kr.co.kac.airtalk

import android.Manifest
import android.app.Activity
import android.content.Context
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
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.widget.Toast
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
    private class Capture(val record: AudioRecord, val rate: Int, val effects: List<AudioEffect>)

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

    private val am by lazy { activity.getSystemService(Context.AUDIO_SERVICE) as AudioManager }
    private val main = Handler(Looper.getMainLooper())
    private var lastNotified: String? = null // main 스레드 전용

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
    fun start(): Boolean {
        if (running) return true
        if (activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            // 다음 시도가 성공하도록 권한 요청을 올려 두고 이번엔 실패를 알린다(페이지가 폴백/안내)
            activity.runOnUiThread {
                activity.requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), 1)
            }
            return false
        }
        val c = open() ?: return false
        running = true
        val myGen = ++gen
        try {
            am.registerAudioDeviceCallback(deviceCallback, main)
        } catch (_: Exception) {
        }
        thread = Thread({ loop(c, myGen) }, "airtalk-audio").apply {
            isDaemon = true
            start()
        }
        return true
    }

    /** AudioRecord 생성 → 입력 장치 지정 → 효과 부착 → 녹음 시작. 실패 시 null(자원 정리 완료). */
    private fun open(): Capture? {
        var rec: AudioRecord? = null
        var rate = 0
        for (r in intArrayOf(48000, 44100, 24000, 16000)) {
            val minBuf = AudioRecord.getMinBufferSize(r, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
            if (minBuf <= 0) continue
            try {
                val a = AudioRecord(
                    MediaRecorder.AudioSource.VOICE_RECOGNITION,
                    r,
                    AudioFormat.CHANNEL_IN_MONO,
                    AudioFormat.ENCODING_PCM_16BIT,
                    maxOf(minBuf * 2, r / 5 * 2), // 최소 200ms 버퍼
                )
                if (a.state == AudioRecord.STATE_INITIALIZED) {
                    rec = a
                    rate = r
                    break
                }
                a.release()
            } catch (_: Exception) {
            }
        }
        val record = rec ?: return null
        val dev = pickInput()
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
        val c = Capture(record, rate, effects)
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
            .toString()
        Log.i(TAG, "capture start rate=$rate aec=$aec ns=$ns gain=$inputGain preferred=${describe(dev)}")
        cur = c
        notifyInput(record.routedDevice)
        return c
    }

    private fun loop(first: Capture, myGen: Int) {
        fun alive() = running && gen == myGen
        var c = first
        var inBuf = ShortArray(c.rate / 10) // 100ms
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
            if (dead && alive()) {
                // 장치 분리(USB 수신기 뽑힘 등)로 AudioRecord 가 죽어도 캡처를 끝내지 않고 다시 연다 —
                // 웹은 네이티브 오류를 알 수 없어, 여기서 멈추면 '번역 중'인데 소리만 끊긴 상태가 된다
                Log.w(TAG, "capture read error — reopening")
                close(c)
                var next: Capture? = null
                while (next == null && alive()) {
                    try {
                        Thread.sleep(300)
                    } catch (_: InterruptedException) {
                        break
                    }
                    next = open()
                }
                if (next == null) return // 이미 정리됨(stop 됐거나 중단)
                if (!alive()) {
                    close(next)
                    return
                }
                c = next
                if (inBuf.size != c.rate / 10) inBuf = ShortArray(c.rate / 10)
                continue
            }
            if (!alive()) break
            if (off <= 0) continue
            val out = to24k(inBuf, off, c.rate)
            val bytes = ByteArray(out.size * 2)
            var j = 0
            for (s in out) {
                val v = s.toInt()
                bytes[j++] = (v and 0xff).toByte()
                bytes[j++] = ((v shr 8) and 0xff).toByte()
            }
            val b64 = Base64.encodeToString(bytes, Base64.NO_WRAP)
            // base64 문자셋([A-Za-z0-9+/=])은 JS 문자열 리터럴에 그대로 안전
            webView.post {
                webView.evaluateJavascript("window.__kacNA&&window.__kacNA(\"$b64\")", null)
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

    /**
     * 외부 마이크 우선: USB(USB-C 무선 수신기·USB 마이크) → 유선 이어폰 마이크 → 없으면 null(OS 기본 = 내장 마이크).
     * 블루투스 마이크는 통화용 협대역(SCO) 경로라 인식률이 떨어지므로 고르지 않는다.
     */
    private fun pickInput(): AudioDeviceInfo? = try {
        val ins = am.getDevices(AudioManager.GET_DEVICES_INPUTS)
        ins.firstOrNull { it.type == AudioDeviceInfo.TYPE_USB_HEADSET || it.type == AudioDeviceInfo.TYPE_USB_DEVICE }
            ?: ins.firstOrNull { it.type == AudioDeviceInfo.TYPE_WIRED_HEADSET }
    } catch (_: Exception) {
        null
    }

    /** 장치 연결·분리 → 진행 중인 캡처의 선호 입력만 교체(AudioRecord 가 끊김 없이 재라우팅) */
    private fun reroute() {
        val c = cur ?: return
        try {
            c.record.setPreferredDevice(pickInput())
        } catch (_: Exception) {
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
            AudioDeviceInfo.TYPE_BLUETOOTH_SCO -> "블루투스 마이크"
            else -> "입력 장치(${d.type})"
        }
        val name = d.productName?.toString()?.trim().orEmpty()
        return if (name.isEmpty()) kind else "$kind ($name)"
    }

    /** 앱 정보용: 캡처 중이면 실제로 쓰는 입력, 대기 중이면 다음 시작 때 고를 입력 */
    fun inputStatus(): String {
        val c = cur
        return if (c != null) {
            "사용 중 — ${describe(c.record.routedDevice)}"
        } else {
            "대기 — 시작하면 ${pickInput()?.let { describe(it) } ?: "내장 마이크"}"
        }
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
        if (!running && thread == null) return
        running = false
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

    /** 마지막 캡처 구성(JSON): {source, rate, aec, ns, preferred} — 앱 정보·현장 진단용 */
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
    }
}
