package com.ventasdechances.app;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(BluetoothPrinterPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
