package ch.spritzwerkgrab.arbeitskarte;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.util.Log;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Native HTML printing via the Android Print Framework.
 *
 * The WebView's own `window.print()` is a no-op on Android, so the web fallback
 * (open a tab + window.print) both failed to show a preview AND trapped the user
 * on a chrome-less page. Instead we render the self-contained job-card HTML into
 * an offscreen WebView and hand it to PrintManager, which shows the real system
 * print dialog (printer picker + "Als PDF speichern"), dismissable with Back.
 */
@CapacitorPlugin(name = "Printer")
public class PrinterPlugin extends Plugin {

    private static final String TAG = "AKPrint";

    // Hold a strong reference so the WebView isn't garbage-collected mid-print.
    private WebView printWebView;

    @PluginMethod
    public void printHtml(PluginCall call) {
        final String html = call.getString("html", "");
        final String jobName = call.getString("jobName", "Arbeitskarte");
        if (html.isEmpty()) {
            call.reject("empty html");
            return;
        }
        Log.i(TAG, "printHtml() called, html length=" + html.length());
        getActivity().runOnUiThread(() -> {
            try {
                WebView webView = new WebView(getContext());
                webView.setWebViewClient(new WebViewClient() {
                    @Override
                    public void onPageFinished(WebView view, String url) {
                        Log.i(TAG, "onPageFinished, scheduling print");
                        // Small settle so the inlined SVG car-map + base64 images are
                        // painted before the print adapter snapshots layout.
                        // MUST be a main-looper Handler, NOT view.postDelayed(): this
                        // WebView is never attached to a window, and posts on a
                        // detached View only run once it attaches — i.e. never here
                        // (that bug made the print dialog silently not appear).
                        new Handler(Looper.getMainLooper())
                            .postDelayed(() -> startPrintJob(view, jobName), 250);
                    }
                });
                // baseURL null: the HTML is fully self-contained (inline CSS + data: images).
                webView.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null);
                printWebView = webView;
                Log.i(TAG, "WebView load kicked off");
                call.resolve();
            } catch (Exception e) {
                Log.e(TAG, "printHtml failed", e);
                call.reject("print failed", e);
            }
        });
    }

    private void startPrintJob(WebView webView, String jobName) {
        try {
            // Activity-scoped service: the print UI is an activity overlay.
            PrintManager printManager = (PrintManager) getActivity().getSystemService(Context.PRINT_SERVICE);
            if (printManager == null) {
                Log.e(TAG, "PrintManager is null — no print service");
                return;
            }
            PrintDocumentAdapter adapter = webView.createPrintDocumentAdapter(jobName);
            PrintAttributes attributes = new PrintAttributes.Builder()
                .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
                .build();
            android.print.PrintJob job = printManager.print(jobName, adapter, attributes);
            Log.i(TAG, "printManager.print() invoked, job=" + (job != null ? job.getInfo().getState() : "null"));
        } catch (Exception e) {
            Log.e(TAG, "startPrintJob failed", e);
        }
    }
}
