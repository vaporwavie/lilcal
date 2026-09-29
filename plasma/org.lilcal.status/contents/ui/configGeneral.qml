import QtQuick
import QtQuick.Controls as QQC2
import org.kde.kirigami as Kirigami

Kirigami.FormLayout {
    property alias cfg_command: commandField.text
    property alias cfg_refreshSeconds: refreshField.value

    QQC2.TextField {
        id: commandField
        Kirigami.FormData.label: "Command"
    }
    QQC2.SpinBox {
        id: refreshField
        Kirigami.FormData.label: "Refresh seconds"
        from: 5
        to: 600
    }
}
