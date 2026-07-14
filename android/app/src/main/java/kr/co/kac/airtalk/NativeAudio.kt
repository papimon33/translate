package kr.co.kac.airtalk

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.MediaRecorder
import android.media.audiofx.AcousticEchoCanceler
import android.media.audiofx.AudioEffect
import android.media.audiofx.AutomaticGainControl
import android.media.audiofx.NoiseSuppressor
import android.util.Base64
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONObject

/**
 * 웹 페이지에 `window.AndroidAudio` 로 노출되는 네이티브 마이크 브리지.
 *
 * 브라우저 getUserMedia 와 달리 AGC(자동 게인)가 확실히 꺼진 원음을 24kHz PCM16 으로 공급한다:
 *  - 소스 = VOICE_RECOGNITION(안드로이드 CDD 상 AGC 미적용) + AutomaticGainControl 명시 해제
 *  - AEC(이 기기가 재생하는 TTS 를 마이크에서 제거)·NS(정상 소음 억제)는 지원 기기만 부착
 *  - 소프트웨어 게인(0.1~8.0×)으로 기기별 하드웨어 감도 편차를 보정(앱 관리 메뉴에서 조절)
 *
 * 청크는 약 100ms 단위 base64 로 `window.__kacNA(b64)` 콜백에 전달(≈6.4KB/회).
 * 게이트·VAD 판정은 웹 쪽(기존 적응형 게이트 로직)이 그대로 수행한다 — 이 브리지는
 * '증폭되지 않은 진짜 음량'을 전달하는 것까지만 책임진다.
 */
class NativeAudio(private val activity: Activity, private val webView: WebView) {

    @Volatile
    var gain: Float = 1.0f
        set(value) {
            field = value.coerceIn(0.1f, 8.0f)
        }

    @Volatile
    private var running = false
    private var thread: Thread? = null
    private val effects = mutableListOf<AudioEffect>()

    @Volatile
    private var stat: String = "{}"

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
        val record = rec ?: return false

        effects.clear()
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
        stat = JSONObject()
            .put("source", "voice_recognition")
            .put("rate", rate)
            .put("aec", aec)
            .put("ns", ns)
            .toString()
        Log.i(TAG, "capture start rate=$rate aec=$aec ns=$ns gain=$gain")

        try {
            record.startRecording()
        } catch (e: Exception) {
            releaseAll(record)
            return false
        }
        if (record.recordingState != AudioRecord.RECORDSTATE_RECORDING) {
            releaseAll(record)
            return false
        }
        running = true
        thread = Thread({ loop(record, rate) }, "airtalk-audio").apply {
            isDaemon = true
            start()
        }
        return true
    }

    private fun loop(record: AudioRecord, rate: Int) {
        val inBuf = ShortArray(rate / 10) // 100ms
        while (running) {
            var off = 0
            while (off < inBuf.size && running) {
                val n = record.read(inBuf, off, inBuf.size - off)
                if (n <= 0) {
                    if (n < 0) running = false
                    break
                }
                off += n
            }
            if (!running) break
            if (off <= 0) continue
            val out = to24k(inBuf, off, rate)
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
        try {
            record.stop()
        } catch (_: Exception) {
        }
        releaseAll(record)
        Log.i(TAG, "capture stop")
    }

    private fun releaseAll(record: AudioRecord) {
        for (e in effects) {
            try {
                e.release()
            } catch (_: Exception) {
            }
        }
        effects.clear()
        try {
            record.release()
        } catch (_: Exception) {
        }
    }

    /** 선형 보간 리샘플 → 24kHz(서버·soniox 파이프라인 규격) + 소프트웨어 게인(클리핑 클램프) */
    private fun to24k(buf: ShortArray, len: Int, rate: Int): ShortArray {
        val g = gain
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
        gain = v
    }

    @JavascriptInterface
    fun getGain(): Float = gain

    /** 마지막 캡처 구성(JSON): {source, rate, aec, ns} — 앱 정보·현장 진단용 */
    @JavascriptInterface
    fun info(): String = stat

    /** 기기 미디어 볼륨(TTS 재생 크기) 0.0~1.0 — 웹은 기기 마스터 볼륨을 못 만지므로 브리지로 제공 */
    @JavascriptInterface
    fun setMediaVolume(v: Float) {
        try {
            val am = activity.getSystemService(Context.AUDIO_SERVICE) as AudioManager
            val max = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
            am.setStreamVolume(AudioManager.STREAM_MUSIC, (v.coerceIn(0f, 1f) * max + 0.5f).toInt(), 0)
        } catch (_: Exception) {
        }
    }

    @JavascriptInterface
    fun getMediaVolume(): Float = try {
        val am = activity.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        am.getStreamVolume(AudioManager.STREAM_MUSIC).toFloat() / am.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
    } catch (_: Exception) {
        1f
    }

    companion object {
        private const val TAG = "AirTalkAudio"
    }
}
