import QtQuick
import QtQuick.Layouts
import org.kde.plasma.plasmoid
import org.kde.plasma.core as PlasmaCore
import org.kde.plasma.components as PlasmaComponents
import org.kde.plasma.plasma5support as Plasma5Support
import org.kde.kirigami as Kirigami

PlasmoidItem {
    id: root

    property var status: null
    property string error: ""
    property bool busy: false
    readonly property string command: Plasmoid.configuration.command
    readonly property int overdueCount: status ? status.overdue.length : 0
    readonly property string line: error ? "lilcal: " + error : status ? status.line : "lilcal"

    Plasmoid.icon: "x-office-calendar"
    Plasmoid.status: overdueCount > 0 ? PlasmaCore.Types.NeedsAttentionStatus : PlasmaCore.Types.ActiveStatus
    toolTipMainText: status && status.next ? status.next.title : "lilcal"
    toolTipSubText: status && status.next ? status.next.when : line

    function shellQuote(text) {
        return "'" + String(text).replace(/'/g, "'\\''") + "'";
    }

    function refresh() {
        if (busy) return;
        busy = true;
        runner.connectSource(command + " status --json");
    }

    function markDone(id) {
        actions.connectSource(command + " done " + shellQuote(id));
    }

    function openPi(id) {
        actions.connectSource(command + " pi " + shellQuote(id));
    }

    function rebuild() {
        rows.clear();
        if (!status) return;
        const add = (section, list) => {
            for (const e of list) rows.append({ section: section, itemId: e.id, title: e.title, label: e.label, tags: e.tags.join(" "), overdue: e.overdue, task: e.task, prompt: e.prompt });
        };
        add("Overdue", status.overdue);
        add("Today", status.today);
        add("Later", status.later);
    }

    ListModel { id: rows }

    Plasma5Support.DataSource {
        id: runner
        engine: "executable"
        connectedSources: []
        onNewData: (source, data) => {
            disconnectSource(source);
            root.busy = false;
            const out = data["stdout"] || "";
            if (data["exit code"] !== 0 || !out.trim()) {
                root.error = (data["stderr"] || "command failed").trim();
                return;
            }
            try {
                root.status = JSON.parse(out);
                root.error = "";
                root.rebuild();
            } catch (e) {
                root.error = "bad output";
            }
        }
    }

    Plasma5Support.DataSource {
        id: actions
        engine: "executable"
        connectedSources: []
        onNewData: (source, data) => {
            disconnectSource(source);
            root.refresh();
        }
    }

    Timer {
        interval: Math.max(5, Plasmoid.configuration.refreshSeconds) * 1000
        running: true
        repeat: true
        triggeredOnStart: true
        onTriggered: root.refresh()
    }

    onCommandChanged: refresh()
    onExpandedChanged: if (expanded) refresh()

    compactRepresentation: MouseArea {
        id: compact
        readonly property bool vertical: Plasmoid.formFactor === PlasmaCore.Types.Vertical
        Layout.minimumWidth: vertical ? Kirigami.Units.iconSizes.small : compactRow.implicitWidth + Kirigami.Units.smallSpacing * 2
        Layout.preferredWidth: Layout.minimumWidth
        Layout.fillHeight: true
        hoverEnabled: true
        onClicked: root.expanded = !root.expanded

        RowLayout {
            id: compactRow
            anchors.centerIn: parent
            spacing: Kirigami.Units.smallSpacing

            Kirigami.Icon {
                source: root.overdueCount > 0 ? "data-warning" : "x-office-calendar"
                color: root.overdueCount > 0 ? Kirigami.Theme.negativeTextColor : Kirigami.Theme.textColor
                Layout.preferredWidth: Kirigami.Units.iconSizes.small
                Layout.preferredHeight: Kirigami.Units.iconSizes.small
            }
            PlasmaComponents.Label {
                visible: !compact.vertical
                text: root.line
                color: root.overdueCount > 0 ? Kirigami.Theme.negativeTextColor : Kirigami.Theme.textColor
                elide: Text.ElideRight
                Layout.maximumWidth: Kirigami.Units.gridUnit * 28
            }
        }
    }

    fullRepresentation: ColumnLayout {
        Layout.preferredWidth: Kirigami.Units.gridUnit * 26
        Layout.preferredHeight: Kirigami.Units.gridUnit * 20
        Layout.minimumWidth: Kirigami.Units.gridUnit * 18
        Layout.minimumHeight: Kirigami.Units.gridUnit * 10
        Layout.margins: Kirigami.Units.smallSpacing
        spacing: Kirigami.Units.smallSpacing

        RowLayout {
            Layout.fillWidth: true
            Kirigami.Heading {
                level: 3
                text: root.status && root.status.next ? root.status.line : "lilcal"
                elide: Text.ElideRight
                Layout.fillWidth: true
            }
            PlasmaComponents.ToolButton {
                icon.name: "view-refresh"
                enabled: !root.busy
                onClicked: root.refresh()
            }
        }

        PlasmaComponents.Label {
            visible: root.error !== ""
            text: root.error
            color: Kirigami.Theme.negativeTextColor
            wrapMode: Text.Wrap
            Layout.fillWidth: true
        }

        PlasmaComponents.ScrollView {
            Layout.fillWidth: true
            Layout.fillHeight: true

            ListView {
                id: list
                model: rows
                clip: true
                spacing: Kirigami.Units.smallSpacing / 2
                section.property: "section"
                section.delegate: Kirigami.ListSectionHeader {
                    required property string section
                    text: section
                    width: list.width
                }
                delegate: RowLayout {
                    id: row
                    required property string itemId
                    required property string title
                    required property string label
                    required property string tags
                    required property bool overdue
                    required property bool task
                    required property bool prompt
                    width: list.width
                    spacing: Kirigami.Units.smallSpacing

                    PlasmaComponents.Label {
                        text: row.label
                        color: row.overdue ? Kirigami.Theme.negativeTextColor : Kirigami.Theme.disabledTextColor
                        Layout.preferredWidth: Kirigami.Units.gridUnit * 6
                        elide: Text.ElideRight
                    }
                    ColumnLayout {
                        Layout.fillWidth: true
                        spacing: 0
                        PlasmaComponents.Label {
                            text: row.title + (row.task ? "  [pi]" : "")
                            elide: Text.ElideRight
                            Layout.fillWidth: true
                        }
                        PlasmaComponents.Label {
                            visible: row.tags !== ""
                            text: row.tags.split(" ").map(t => "#" + t).join(" ")
                            color: Kirigami.Theme.disabledTextColor
                            font.pointSize: Kirigami.Theme.smallFont.pointSize
                            elide: Text.ElideRight
                            Layout.fillWidth: true
                        }
                    }
                    PlasmaComponents.ToolButton {
                        visible: row.prompt
                        icon.name: "media-playback-start"
                        onClicked: root.openPi(row.itemId)
                    }
                    PlasmaComponents.ToolButton {
                        icon.name: "checkmark"
                        onClicked: root.markDone(row.itemId)
                    }
                }
            }
        }

        PlasmaComponents.Label {
            visible: rows.count === 0 && root.error === ""
            text: "Nothing scheduled."
            color: Kirigami.Theme.disabledTextColor
            Layout.alignment: Qt.AlignHCenter
        }
    }
}
