package com.ventasdechances.app;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothSocket;
import android.content.Intent;
import android.os.Build;
import android.provider.Settings;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import java.io.OutputStream;
import java.nio.charset.Charset;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(
    name = "BluetoothPrinter",
    permissions = {
        @Permission(
            alias = "bluetooth",
            strings = {
                Manifest.permission.BLUETOOTH_CONNECT
            }
        )
    }
)
public class BluetoothPrinterPlugin extends Plugin {

    private static final UUID SPP_UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");
    private final ExecutorService printerExecutor = Executors.newSingleThreadExecutor();

    @PluginMethod
    public void listBondedDevices(PluginCall call) {
        if (!hasBluetoothPermission()) {
            call.reject("La app no tiene permiso Bluetooth.");
            return;
        }

        BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
        if (adapter == null) {
            call.reject("Este dispositivo no soporta Bluetooth.");
            return;
        }
        if (!adapter.isEnabled()) {
            call.reject("Bluetooth esta apagado.");
            return;
        }

        JSArray devices = new JSArray();
        Set<BluetoothDevice> bondedDevices = adapter.getBondedDevices();
        for (BluetoothDevice device : bondedDevices) {
            JSObject item = new JSObject();
            item.put("name", safeDeviceName(device));
            item.put("address", device.getAddress());
            devices.put(item);
        }

        JSObject result = new JSObject();
        result.put("devices", devices);
        call.resolve(result);
    }

    @PluginMethod
    public void openBluetoothSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_BLUETOOTH_SETTINGS);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    @PluginMethod
    public void print(PluginCall call) {
        String address = call.getString("address", "");
        String text = call.getString("text", "");
        String qr = call.getString("qr", "");

        if (address.isEmpty()) {
            call.reject("No se recibio la direccion de la impresora.");
            return;
        }
        if (text.isEmpty()) {
            call.reject("No hay contenido para imprimir.");
            return;
        }
        if (!hasBluetoothPermission()) {
            call.reject("La app no tiene permiso Bluetooth.");
            return;
        }

        printerExecutor.execute(() -> {
            BluetoothSocket socket = null;
            try {
                BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
                if (adapter == null) {
                    call.reject("Este dispositivo no soporta Bluetooth.");
                    return;
                }
                if (!adapter.isEnabled()) {
                    call.reject("Bluetooth esta apagado.");
                    return;
                }

                BluetoothDevice device = adapter.getRemoteDevice(address);
                adapter.cancelDiscovery();
                socket = device.createRfcommSocketToServiceRecord(SPP_UUID);
                socket.connect();

                OutputStream outputStream = socket.getOutputStream();
                outputStream.write(new byte[] { 0x1B, 0x40, 0x1B, 0x74, 0x00 });
                outputStream.write(toPrinterBytes(text));
                if (!qr.isEmpty()) {
                    writeQrCode(outputStream, qr);
                }
                outputStream.write(new byte[] { 0x0A, 0x0A, 0x0A, 0x1D, 0x56, 0x42, 0x00 });
                outputStream.flush();
                call.resolve();
            } catch (Exception error) {
                call.reject("No se pudo imprimir: " + error.getMessage(), error);
            } finally {
                if (socket != null) {
                    try {
                        socket.close();
                    } catch (Exception ignored) {
                    }
                }
            }
        });
    }

    private boolean hasBluetoothPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
            return true;
        }
        return getContext().checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == android.content.pm.PackageManager.PERMISSION_GRANTED;
    }

    private String safeDeviceName(BluetoothDevice device) {
        try {
            String name = device.getName();
            return name == null || name.trim().isEmpty() ? "Impresora Bluetooth" : name;
        } catch (SecurityException error) {
            return "Impresora Bluetooth";
        }
    }

    private byte[] toPrinterBytes(String text) {
        String normalized = text
            .replace("\r\n", "\n")
            .replace("\r", "\n")
            .replace("\n", "\r\n");
        return normalized.getBytes(Charset.forName("CP437"));
    }

    private void writeQrCode(OutputStream outputStream, String value) throws Exception {
        byte[] data = value.getBytes(Charset.forName("CP437"));
        int storeLen = data.length + 3;
        int pL = storeLen & 0xFF;
        int pH = (storeLen >> 8) & 0xFF;

        outputStream.write(new byte[] { 0x1D, 0x28, 0x6B, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00 });
        outputStream.write(new byte[] { 0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x43, 0x06 });
        outputStream.write(new byte[] { 0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x45, 0x31 });
        outputStream.write(new byte[] { 0x1B, 0x61, 0x01 });
        outputStream.write(new byte[] { 0x1D, 0x28, 0x6B, (byte) pL, (byte) pH, 0x31, 0x50, 0x30 });
        outputStream.write(data);
        outputStream.write(new byte[] { 0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x51, 0x30 });
        outputStream.write(new byte[] { 0x1B, 0x61, 0x00 });
    }
}
