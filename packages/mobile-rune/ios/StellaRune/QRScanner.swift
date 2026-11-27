import AVFoundation
import UIKit

/// `scanner.scan` (`ui/native/scanner.ts`): the camera full screen until it reads a QR code, for
/// a computer's pairing code (`stella://p2p?c=…`). Replies with the code's text, or null when the
/// person closes it; fails with code `denied` (no camera access) or `unavailable` (no camera, as
/// in the Simulator).
final class QRScanner: NSObject {
  static let shared = QRScanner()

  func handle(_ m: [String: Any]) -> Bool {
    guard m["cmd"] as? String == "scanner.scan" else { return false }
    switch AVCaptureDevice.authorizationStatus(for: .video) {
    case .authorized:
      present(m)
    case .notDetermined:
      AVCaptureDevice.requestAccess(for: .video) { granted in
        DispatchQueue.main.async {
          if granted { self.present(m) } else { PhoneRequests.fail(m, "Stella can't use the camera.", code: "denied") }
        }
      }
    default:
      PhoneRequests.fail(m, "Stella can't use the camera.", code: "denied")
    }
    return true
  }

  private func present(_ m: [String: Any]) {
    guard let camera = AVCaptureDevice.default(for: .video), let input = try? AVCaptureDeviceInput(device: camera) else {
      PhoneRequests.fail(m, "This device has no camera.", code: "unavailable")
      return
    }
    var top = App.shared.window?.rootViewController
    while let p = top?.presentedViewController { top = p }
    guard let top else { return PhoneRequests.fail(m, "The camera couldn't open.", code: "unavailable") }
    let vc = ScannerController(input: input, hint: m["hint"] as? String) { text in
      PhoneRequests.reply(m, text)
    }
    vc.modalPresentationStyle = .fullScreen
    top.present(vc, animated: true)
  }
}

private final class ScannerController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
  private let session = AVCaptureSession()
  private let input: AVCaptureDeviceInput
  private let hint: String?
  private var done: ((String?) -> Void)?
  private var preview: AVCaptureVideoPreviewLayer?

  init(input: AVCaptureDeviceInput, hint: String?, done: @escaping (String?) -> Void) {
    self.input = input
    self.hint = hint
    self.done = done
    super.init(nibName: nil, bundle: nil)
  }

  required init?(coder: NSCoder) { fatalError() }

  override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .black
    let output = AVCaptureMetadataOutput()
    if session.canAddInput(input) { session.addInput(input) }
    if session.canAddOutput(output) {
      session.addOutput(output)
      output.setMetadataObjectsDelegate(self, queue: .main)
      if output.availableMetadataObjectTypes.contains(.qr) { output.metadataObjectTypes = [.qr] }
    }
    let layer = AVCaptureVideoPreviewLayer(session: session)
    layer.videoGravity = .resizeAspectFill
    view.layer.addSublayer(layer)
    preview = layer

    let frame = UIView()
    frame.translatesAutoresizingMaskIntoConstraints = false
    frame.layer.borderColor = UIColor.white.withAlphaComponent(0.9).cgColor
    frame.layer.borderWidth = 2
    frame.layer.cornerRadius = 24
    view.addSubview(frame)

    let label = UILabel()
    label.translatesAutoresizingMaskIntoConstraints = false
    label.text = hint
    label.textColor = .white
    label.font = AppFonts.font(family: AppFonts.sans ?? "", size: 17, weight: 500) ?? .systemFont(ofSize: 17, weight: .medium)
    label.textAlignment = .center
    label.numberOfLines = 0
    view.addSubview(label)

    var close = UIButton.Configuration.filled()
    close.image = UIImage(systemName: "xmark", withConfiguration: UIImage.SymbolConfiguration(pointSize: 17, weight: .semibold))
    close.baseBackgroundColor = UIColor.white.withAlphaComponent(0.18)
    close.baseForegroundColor = .white
    close.cornerStyle = .capsule
    let button = UIButton(configuration: close, primaryAction: UIAction { [weak self] _ in self?.finish(nil) })
    button.translatesAutoresizingMaskIntoConstraints = false
    button.accessibilityLabel = "Close"
    view.addSubview(button)

    NSLayoutConstraint.activate([
      frame.centerXAnchor.constraint(equalTo: view.centerXAnchor),
      frame.centerYAnchor.constraint(equalTo: view.centerYAnchor, constant: -20),
      frame.widthAnchor.constraint(equalTo: view.widthAnchor, multiplier: 0.68),
      frame.heightAnchor.constraint(equalTo: frame.widthAnchor),
      label.topAnchor.constraint(equalTo: frame.bottomAnchor, constant: 28),
      label.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 32),
      label.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -32),
      button.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 8),
      button.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 10),
      button.widthAnchor.constraint(equalToConstant: 44),
      button.heightAnchor.constraint(equalToConstant: 44),
    ])
  }

  override func viewDidLayoutSubviews() {
    super.viewDidLayoutSubviews()
    preview?.frame = view.bounds
  }

  override func viewWillAppear(_ animated: Bool) {
    super.viewWillAppear(animated)
    let session = self.session
    DispatchQueue.global(qos: .userInitiated).async { session.startRunning() }
  }

  override func viewWillDisappear(_ animated: Bool) {
    super.viewWillDisappear(animated)
    let session = self.session
    DispatchQueue.global(qos: .userInitiated).async { session.stopRunning() }
    // Swiped away or closed by the system: still one answer.
    finish(nil, dismiss: false)
  }

  func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput objects: [AVMetadataObject], from connection: AVCaptureConnection) {
    guard let code = objects.compactMap({ ($0 as? AVMetadataMachineReadableCodeObject)?.stringValue }).first(where: { !$0.isEmpty }) else { return }
    UINotificationFeedbackGenerator().notificationOccurred(.success)
    finish(code)
  }

  private func finish(_ text: String?, dismiss: Bool = true) {
    guard let done else { return }
    self.done = nil
    done(text)
    if dismiss { self.dismiss(animated: true) }
  }
}
