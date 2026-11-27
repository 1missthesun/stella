export function Root() {
  return (
    <window id="main" title="rtl insets" bg="#ffffff" w={500} h={300}>
      <col id="page" dir="rtl" grow={1} pad={20} gap={12}>
        <row id="row" gap={8}>
          <box id="first" w={60} h={30} fill="#3478f6" />
          <box id="second" w={60} h={30} fill="#34c759" />
        </row>
        <box id="card" h={120} fill="#eeeeee" radius={8}>
          <box id="close" absolute={{ top: 14, right: 14 }} w={24} h={24} radius={12} fill="#ff3b30" />
          <box id="pin-left" absolute={{ bottom: 10, left: 10 }} w={24} h={24} fill="#5856d6" />
        </box>
      </col>
    </window>
  );
}
