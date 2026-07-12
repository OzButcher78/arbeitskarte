package ch.spritzwerkgrab.arbeitskarte;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Must be registered before super.onCreate() so the bridge picks them up.
        registerPlugin(AppSettingsPlugin.class);
        registerPlugin(PrinterPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
