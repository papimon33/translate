package kr.co.kac.airtalk

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.util.Log
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import android.webkit.ConsoleMessage
import android.webkit.CookieManager
import android.webkit.PermissionRequest
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.SeekBar
import android.widget.TextView

/**
 * AirTalk 안내데스크용 키오스크 셸.
 *
 * 기존 웹앱(호스트 세션·데스크 뷰어·모바일 뷰어)을 WebView 로 그대로 띄우되,
 * 마이크만 네이티브 AudioRecord(AGC 완전 차단)로 캡처해 `window.AndroidAudio` 브리지로 공급한다 —
 * 브라우저(WebView 포함)의 오디오 스택은 AGC off 요청을 기기에 따라 무시해
 * 민감도 게이트를 아무리 낮춰도 속삭임·원거리 소음이 통과하던 문제의 근본 해결.
 */
class MainActivity : Activity() {

    private lateinit var webView: WebView
    private lateinit var nativeAudio: NativeAudio
    private val prefs by lazy { getSharedPreferences("airtalk", Context.MODE_PRIVATE) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // 안내데스크 상시 화면: 절전으로 꺼지면 뷰어 터치 화면이 사라진다
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        webView = WebView(this)
        setContentView(webView)
        setupWebView()

        nativeAudio = NativeAudio(this, webView)
        nativeAudio.gain = prefs.getFloat("gain", 1.0f)
        webView.addJavascriptInterface(nativeAudio, "AndroidAudio")

        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), REQ_MIC)
        }

        val url = prefs.getString("url", null)
        if (url.isNullOrBlank()) askUrl(first = true) else webView.loadUrl(url)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            // 데스크 뷰어·TTS 는 사용자 제스처 없이도 소리를 내야 한다(호스트가 원격으로 응대 시작)
            mediaPlaybackRequiresUserGesture = false
            userAgentString = "$userAgentString AirTalkApp/1.0"
        }
        CookieManager.getInstance().setAcceptCookie(true)
        // 현장 문제를 PC chrome://inspect 로 바로 들여다볼 수 있게 항상 허용(내부 운영 앱)
        WebView.setWebContentsDebuggingEnabled(true)

        webView.webViewClient = object : WebViewClient() {
            override fun onPageStarted(view: WebView?, url: String?, favicon: android.graphics.Bitmap?) {
                // 페이지 이동/새로고침 시 진행 중이던 네이티브 캡처를 반드시 끊는다 —
                // 웹 쪽 핸들러(window.__kacNA)가 사라진 채 마이크만 계속 도는 것을 방지
                nativeAudio.stop()
            }

            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                // WebView 렌더러 크래시 → 액티비티 재생성으로 복구(빈 화면 방치 방지)
                Log.w(TAG, "render process gone (crashed=${detail.didCrash()})")
                nativeAudio.stop()
                recreate()
                return true
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) {
                // 네이티브 브리지 대신 웹 getUserMedia 로 도는 경로(폴백)도 동작하게 마이크만 승인
                runOnUiThread {
                    val grant = request.resources.filter {
                        it == PermissionRequest.RESOURCE_AUDIO_CAPTURE &&
                            checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
                    }
                    if (grant.isEmpty()) request.deny() else request.grant(grant.toTypedArray())
                }
            }

            override fun onConsoleMessage(msg: ConsoleMessage): Boolean {
                Log.d(TAG, "[web] ${msg.message()} (${msg.sourceId()}:${msg.lineNumber()})")
                return true
            }
        }

        // APK 등 파일 다운로드는 외부 브라우저로 넘긴다(WebView 는 다운로드 미지원)
        webView.setDownloadListener { url, _, _, _, _ ->
            try {
                startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
            } catch (_: Exception) {
            }
        }
    }

    /* ---- 몰입 전체화면(키오스크): 시스템 바 숨김, 가장자리 스와이프로 일시 노출 ---- */
    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideSystemBars()
    }

    @Suppress("DEPRECATION")
    private fun hideSystemBars() {
        window.decorView.systemUiVisibility = (
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                or View.SYSTEM_UI_FLAG_FULLSCREEN
                or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            )
    }

    /* ---- 뒤로가기 = 관리 메뉴(웹 히스토리 뒤로가 아니라 키오스크 관리 진입점) ---- */
    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            showMenu()
            return true
        }
        return super.onKeyDown(keyCode, event)
    }

    private fun showMenu() {
        val items = arrayOf("새로고침", "서버 주소 변경", "마이크 입력 게인", "앱 정보")
        AlertDialog.Builder(this)
            .setTitle("AirTalk 관리")
            .setItems(items) { _, i ->
                when (i) {
                    0 -> webView.reload()
                    1 -> askUrl(first = false)
                    2 -> askGain()
                    3 -> showInfo()
                }
            }
            .setNegativeButton("닫기", null)
            .show()
    }

    private fun askUrl(first: Boolean) {
        val input = EditText(this).apply {
            hint = "예: https://airtalk.example.com 또는 http://192.168.0.10:3001/desk.html?session=..."
            setText(prefs.getString("url", "") ?: "")
        }
        val wrap = LinearLayout(this).apply {
            setPadding(48, 24, 48, 0)
            addView(input, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        }
        val b = AlertDialog.Builder(this)
            .setTitle("서버 주소")
            .setMessage("AirTalk 서버 주소(또는 뷰어 전체 링크)를 입력하세요. 이 기기는 항상 이 주소를 엽니다.")
            .setView(wrap)
            .setCancelable(!first)
            .setPositiveButton("저장") { _, _ ->
                var u = input.text.toString().trim()
                if (u.isEmpty()) {
                    if (first) askUrl(true)
                    return@setPositiveButton
                }
                if (!u.startsWith("http://") && !u.startsWith("https://")) u = "https://$u"
                prefs.edit().putString("url", u).apply()
                webView.loadUrl(u)
            }
        if (!first) b.setNegativeButton("취소", null)
        b.show()
    }

    private fun askGain() {
        val cur = prefs.getFloat("gain", 1.0f)
        val label = TextView(this).apply { textSize = 16f }
        val seek = SeekBar(this).apply {
            max = 79 // progress+1 → 0.1×~8.0×
            progress = ((cur * 10).toInt() - 1).coerceIn(0, 79)
        }
        fun fmt(p: Int) = "×%.1f".format((p + 1) / 10f)
        label.text = "마이크 입력 게인: ${fmt(seek.progress)}"
        seek.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(s: SeekBar?, p: Int, fromUser: Boolean) {
                label.text = "마이크 입력 게인: ${fmt(p)}"
            }
            override fun onStartTrackingTouch(s: SeekBar?) {}
            override fun onStopTrackingTouch(s: SeekBar?) {}
        })
        val wrap = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(48, 24, 48, 0)
            addView(label)
            addView(seek)
        }
        AlertDialog.Builder(this)
            .setTitle("마이크 입력 게인")
            .setMessage("이 앱은 자동 증폭(AGC) 없이 원음 그대로 인식합니다. 소리가 너무 작거나 크면 여기서 보정하세요. 기본 ×1.0")
            .setView(wrap)
            .setPositiveButton("적용") { _, _ ->
                val g = (seek.progress + 1) / 10f
                prefs.edit().putFloat("gain", g).apply()
                nativeAudio.gain = g
            }
            .setNegativeButton("취소", null)
            .show()
    }

    private fun showInfo() {
        val ver = try {
            packageManager.getPackageInfo(packageName, 0).versionName
        } catch (_: Exception) {
            "?"
        }
        AlertDialog.Builder(this)
            .setTitle("AirTalk $ver")
            .setMessage(
                "서버: ${prefs.getString("url", "-")}\n" +
                    "마이크 게인: ×${prefs.getFloat("gain", 1.0f)}\n" +
                    "오디오: ${nativeAudio.info()}\n\n" +
                    "네이티브 마이크(AGC 차단)로 캡처합니다. 문제 시 PC 크롬 chrome://inspect 로 원격 점검할 수 있습니다."
            )
            .setPositiveButton("확인", null)
            .show()
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQ_MIC && grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) {
            // 권한 승인 전에 시작 실패한 페이지가 다시 시도하도록 새로고침
            webView.reload()
        }
    }

    override fun onDestroy() {
        nativeAudio.stop()
        try {
            webView.destroy()
        } catch (_: Exception) {
        }
        super.onDestroy()
    }

    companion object {
        private const val TAG = "AirTalk"
        private const val REQ_MIC = 1
    }
}
