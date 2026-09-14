import 'package:flutter/material.dart';
import '../../core/api/auth_api_client.dart';
import '../../core/state/session.dart';
import '../../core/theme/vuel_theme.dart';

enum _AuthStep { login, register, otp }

/// Écran d'authentification — reprend les 3 étapes de la PWA (Se connecter /
/// Créer un compte / Code OTP), cf. pwa/index.html section <!-- ============ AUTH -->.
class AuthScreen extends StatefulWidget {
  final Session session;
  final VoidCallback onAuthenticated;

  const AuthScreen({super.key, required this.session, required this.onAuthenticated});

  @override
  State<AuthScreen> createState() => _AuthScreenState();
}

class _AuthScreenState extends State<AuthScreen> {
  _AuthStep _step = _AuthStep.login;
  bool _loading = false;
  bool _showLoginPassword = false;
  bool _showRegPassword = false;
  String? _error;
  String _pendingPhone = '';

  final _apiBaseController = TextEditingController();
  final _loginPhone = TextEditingController();
  final _loginPassword = TextEditingController();
  final _regPhone = TextEditingController();
  final _regPseudo = TextEditingController();
  final _regPassword = TextEditingController();
  final _otpCode = TextEditingController();

  late AuthApiClient _authClient;

  @override
  void initState() {
    super.initState();
    _apiBaseController.text = widget.session.apiBaseUrl;
    _authClient = AuthApiClient(baseUrl: widget.session.apiBaseUrl);
  }

  Future<void> _applyApiBase() async {
    await widget.session.setApiBaseUrl(_apiBaseController.text);
    _authClient = AuthApiClient(baseUrl: widget.session.apiBaseUrl);
  }

  Future<void> _run(Future<void> Function() action) async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      await _applyApiBase();
      await action();
    } catch (e) {
      setState(() => _error = e.toString().replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _doLogin() => _run(() async {
        final tokens = await _authClient.login(phone: _loginPhone.text.trim(), password: _loginPassword.text);
        await widget.session.setTokens(accessToken: tokens.accessToken, refreshToken: tokens.refreshToken);
        widget.onAuthenticated();
      });

  Future<void> _doRegister() => _run(() async {
        await _authClient.register(
          phone: _regPhone.text.trim(),
          pseudo: _regPseudo.text.trim(),
          password: _regPassword.text,
        );
        _pendingPhone = _regPhone.text.trim();
        setState(() => _step = _AuthStep.otp);
      });

  Future<void> _doVerifyOtp() => _run(() async {
        final tokens = await _authClient.verifyOtp(phone: _pendingPhone, code: _otpCode.text.trim());
        await widget.session.setTokens(accessToken: tokens.accessToken, refreshToken: tokens.refreshToken);
        widget.onAuthenticated();
      });

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 380),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Center(
                    child: Column(
                      children: [
                        const Icon(Icons.bolt, color: VuelColors.amber, size: 48),
                        const SizedBox(height: 8),
                        const Text(
                          'Vuel',
                          style: TextStyle(fontSize: 28, fontWeight: FontWeight.bold, color: VuelColors.text),
                        ),
                        const Text('Affronte, gagne, encaisse.', style: TextStyle(color: VuelColors.muted, fontSize: 12)),
                      ],
                    ),
                  ),
                  const SizedBox(height: 28),
                  if (_step != _AuthStep.otp) ...[
                    Row(
                      children: [
                        Expanded(
                          child: _TabButton(
                            label: 'Se connecter',
                            active: _step == _AuthStep.login,
                            onTap: () => setState(() => _step = _AuthStep.login),
                          ),
                        ),
                        Expanded(
                          child: _TabButton(
                            label: 'Créer un compte',
                            active: _step == _AuthStep.register,
                            onTap: () => setState(() => _step = _AuthStep.register),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 16),
                  ],
                  if (_step == _AuthStep.login) ..._buildLoginForm(),
                  if (_step == _AuthStep.register) ..._buildRegisterForm(),
                  if (_step == _AuthStep.otp) ..._buildOtpForm(),
                  if (_error != null) ...[
                    const SizedBox(height: 12),
                    Text(_error!, textAlign: TextAlign.center, style: const TextStyle(color: VuelColors.red, fontSize: 12)),
                  ],
                  const SizedBox(height: 20),
                  ExpansionTile(
                    tilePadding: EdgeInsets.zero,
                    title: const Text('Adresse du serveur', style: TextStyle(color: VuelColors.muted, fontSize: 12)),
                    children: [
                      TextField(
                        controller: _apiBaseController,
                        decoration: const InputDecoration(labelText: 'https://vuel.onrender.com'),
                        style: const TextStyle(color: VuelColors.text, fontSize: 13),
                      ),
                      const SizedBox(height: 8),
                      const Text(
                        'Par défaut, l\'app utilise le serveur Vuel hébergé sur Render. Change cette adresse uniquement si tu testes contre un serveur local (ex: http://<IP-de-ton-PC>:3000, jamais "localhost" depuis un vrai téléphone).',
                        style: TextStyle(color: VuelColors.muted, fontSize: 11),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  List<Widget> _buildLoginForm() {
    return [
      const _FieldLabel('Téléphone'),
      TextField(controller: _loginPhone, keyboardType: TextInputType.phone, decoration: const InputDecoration(hintText: '+225...')),
      const SizedBox(height: 12),
      const _FieldLabel('Mot de passe'),
      TextField(
        controller: _loginPassword,
        obscureText: !_showLoginPassword,
        decoration: InputDecoration(
          suffixIcon: IconButton(
            icon: Icon(_showLoginPassword ? Icons.visibility_off : Icons.visibility, color: VuelColors.muted, size: 20),
            onPressed: () => setState(() => _showLoginPassword = !_showLoginPassword),
          ),
        ),
      ),
      const SizedBox(height: 20),
      ElevatedButton(
        onPressed: _loading ? null : _doLogin,
        child: _loading ? const _LoadingDot() : const Text('Se connecter'),
      ),
    ];
  }

  List<Widget> _buildRegisterForm() {
    return [
      const _FieldLabel('Téléphone'),
      TextField(controller: _regPhone, keyboardType: TextInputType.phone, decoration: const InputDecoration(hintText: '+225...')),
      const SizedBox(height: 12),
      const _FieldLabel('Pseudo'),
      TextField(controller: _regPseudo, decoration: const InputDecoration()),
      const SizedBox(height: 12),
      const _FieldLabel('Mot de passe (min. 8 caractères)'),
      TextField(
        controller: _regPassword,
        obscureText: !_showRegPassword,
        decoration: InputDecoration(
          suffixIcon: IconButton(
            icon: Icon(_showRegPassword ? Icons.visibility_off : Icons.visibility, color: VuelColors.muted, size: 20),
            onPressed: () => setState(() => _showRegPassword = !_showRegPassword),
          ),
        ),
      ),
      const SizedBox(height: 20),
      ElevatedButton(
        onPressed: _loading ? null : _doRegister,
        child: _loading ? const _LoadingDot() : const Text('Recevoir mon code'),
      ),
    ];
  }

  List<Widget> _buildOtpForm() {
    return [
      Text(
        'Code envoyé au $_pendingPhone',
        textAlign: TextAlign.center,
        style: const TextStyle(color: VuelColors.muted, fontSize: 13),
      ),
      const SizedBox(height: 4),
      const Text(
        '(mode dev : le code s\'affiche dans les logs Render tant que Twilio n\'est pas configuré — onglet "Logs" de ton service sur render.com)',
        textAlign: TextAlign.center,
        style: TextStyle(color: VuelColors.muted, fontSize: 11),
      ),
      const SizedBox(height: 16),
      const _FieldLabel('Code reçu'),
      TextField(
        controller: _otpCode,
        keyboardType: TextInputType.number,
        maxLength: 6,
        decoration: const InputDecoration(counterText: ''),
      ),
      const SizedBox(height: 20),
      ElevatedButton(
        onPressed: _loading ? null : _doVerifyOtp,
        child: _loading ? const _LoadingDot() : const Text('Valider'),
      ),
      TextButton(
        onPressed: () => setState(() => _step = _AuthStep.register),
        child: const Text('Retour', style: TextStyle(color: VuelColors.muted)),
      ),
    ];
  }
}

class _FieldLabel extends StatelessWidget {
  final String text;
  const _FieldLabel(this.text);

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: Text(text, style: const TextStyle(color: VuelColors.muted, fontSize: 11)),
    );
  }
}

class _TabButton extends StatelessWidget {
  final String label;
  final bool active;
  final VoidCallback onTap;
  const _TabButton({required this.label, required this.active, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 10),
        decoration: BoxDecoration(
          color: active ? VuelColors.amberDim : VuelColors.surface2,
          borderRadius: BorderRadius.circular(10),
        ),
        margin: const EdgeInsets.symmetric(horizontal: 2),
        alignment: Alignment.center,
        child: Text(
          label,
          style: TextStyle(
            color: active ? VuelColors.amber : VuelColors.muted,
            fontWeight: active ? FontWeight.w600 : FontWeight.normal,
            fontSize: 13,
          ),
        ),
      ),
    );
  }
}

class _LoadingDot extends StatelessWidget {
  const _LoadingDot();

  @override
  Widget build(BuildContext context) {
    return const SizedBox(
      width: 18,
      height: 18,
      child: CircularProgressIndicator(strokeWidth: 2, color: Color(0xFF412402)),
    );
  }
}
