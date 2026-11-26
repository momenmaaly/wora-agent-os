/* WORA experience prototype — read-only, recorded data. */
(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const clamp = (value, max = 140) => String(value ?? '').length > max ? `${String(value).slice(0, max).trimEnd()}…` : String(value ?? '');
  const dtf = (locale) => new Intl.DateTimeFormat(locale === 'ar' ? 'ar-u-nu-latn' : 'en', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const date = (value, locale) => value ? dtf(locale).format(new Date(value)) : '—';
  const shortDate = (value, locale) => value ? new Intl.DateTimeFormat(locale === 'ar' ? 'ar-u-nu-latn' : 'en', { month: 'short', day: 'numeric' }).format(new Date(value)) : '—';
  const num = (value) => new Intl.NumberFormat('en').format(Number(value) || 0);
  const pct = (done, total) => total ? Math.round((done / total) * 100) : 0;
  const pad = (value) => String(value).padStart(2, '0');
  const strip = (value) => String(value ?? '').replace(/[-_]/g, ' ');

  const state = {
    zone: 'run',
    tab: 'plan',
    libraryTab: 'artifacts',
    capTab: 'agents',
    systemTab: 'runtime',
    locale: localStorage.getItem('wora-proto-locale') || 'ar',
    theme: localStorage.getItem('wora-proto-theme') || 'light',
    selectedTaskId: null,
    selectedAgentId: null,
    selectedPackageId: null,
    returnFocus: null,
    filter: '',
    activityFilter: 'all',
    artifactRaw: false,
    palette: false,
    sheet: null,
    toastTimer: null
  };

  let D = null;
  let M = null;

  const STR = {};
  const t = (key, vars = {}) => {
    const pair = STR[key];
    const text = pair ? pair[state.locale] : key;
    return Object.entries(vars).reduce((out, [k, v]) => out.replaceAll(`{${k}}`, String(v)), text);
  };

  Object.assign(STR, {
    'app.tagline': { ar: 'نظام تشغيل للعمل الذكي', en: 'Operating system for intelligent work' },
    'app.prototype': { ar: 'نموذج تصميم', en: 'Design prototype' },
    'app.recorded': { ar: 'بيانات مسجّلة', en: 'Recorded data' },
    'app.language': { ar: 'English', en: 'العربية' },
    'app.languageLabel': { ar: 'تغيير اللغة', en: 'Change language' },
    'app.light': { ar: 'الوضع الفاتح', en: 'Light mode' },
    'app.dark': { ar: 'الوضع الداكن', en: 'Dark mode' },
    'app.command': { ar: 'بحث أو أمر', en: 'Search or command' },
    'app.noMutation': { ar: 'هذا النموذج للقراءة فقط.', en: 'This prototype is read-only.' },
    'app.source': { ar: 'المصدر', en: 'Source' },
    'zone.brief': { ar: 'الموجز', en: 'Brief' },
    'zone.run': { ar: 'التشغيل', en: 'Run' },
    'zone.library': { ar: 'المكتبة', en: 'Library' },
    'zone.capabilities': { ar: 'القدرات', en: 'Capabilities' },
    'zone.system': { ar: 'النظام', en: 'System' },
    'zone.attention': { ar: 'ما يحتاج انتباهك', en: 'Needs attention' },
    'zone.activeMission': { ar: 'المهمة النشطة', en: 'Active mission' },
    'zone.noMission': { ar: 'لا توجد مهمة نشطة', en: 'No active mission' },
    'common.review': { ar: 'مراجعة', en: 'Review' },
    'common.inspect': { ar: 'فحص', en: 'Inspect' },
    'common.open': { ar: 'فتح', en: 'Open' },
    'common.close': { ar: 'إغلاق', en: 'Close' },
    'common.copy': { ar: 'نسخ', en: 'Copy' },
    'common.copied': { ar: 'تم النسخ', en: 'Copied' },
    'common.tasks': { ar: 'المهام', en: 'Tasks' },
    'common.agents': { ar: 'الوكلاء', en: 'Agents' },
    'common.packages': { ar: 'الحزم', en: 'Packages' },
    'common.tools': { ar: 'الأدوات', en: 'Tools' },
    'common.skills': { ar: 'المهارات', en: 'Skills' },
    'common.plugins': { ar: 'الإضافات', en: 'Plugins' },
    'common.installed': { ar: 'مثبّت', en: 'Installed' },
    'common.notInstalled': { ar: 'غير مثبّت', en: 'Not installed' },
    'common.enabled': { ar: 'مفعّل', en: 'Enabled' },
    'common.disabled': { ar: 'معطّل', en: 'Disabled' },
    'common.available': { ar: 'متاح', en: 'Available' },
    'common.status': { ar: 'الحالة', en: 'Status' },
    'common.agent': { ar: 'الوكيل', en: 'Agent' },
    'common.specialization': { ar: 'التخصص', en: 'Specialization' },
    'common.tool': { ar: 'الأداة', en: 'Tool' },
    'common.permissions': { ar: 'الصلاحيات', en: 'Permissions' },
    'common.depends': { ar: 'يعتمد على', en: 'Depends on' },
    'common.noDependencies': { ar: 'لا توجد تبعيات', en: 'No dependencies' },
    'common.acceptance': { ar: 'معايير القبول', en: 'Acceptance criteria' },
    'common.created': { ar: 'أُنشئ', en: 'Created' },
    'common.updated': { ar: 'آخر تحديث', en: 'Updated' },
    'common.version': { ar: 'الإصدار', en: 'Version' },
    'common.author': { ar: 'المؤلف', en: 'Author' },
    'common.trust': { ar: 'الثقة', en: 'Trust' },
    'common.category': { ar: 'الفئة', en: 'Category' },
    'common.type': { ar: 'النوع', en: 'Type' },
    'common.scope': { ar: 'النطاق', en: 'Scope' },
    'common.digest': { ar: 'البصمة', en: 'Digest' },
    'common.none': { ar: 'لا يوجد', en: 'None' },
    'common.notExposed': { ar: 'غير متاح في واجهة البرمجة الحالية', en: 'Not exposed by the current API' },
    'common.empty': { ar: 'لا توجد عناصر', en: 'Nothing here' },
    'common.all': { ar: 'الكل', en: 'All' },
    'common.search': { ar: 'بحث', en: 'Search' },
    'common.showRaw': { ar: 'عرض البيانات الخام', en: 'Show raw data' },
    'common.hideRaw': { ar: 'إخفاء البيانات الخام', en: 'Hide raw data' },
    'common.prototypeOnly': { ar: 'غير مفعّل في النموذج', en: 'Not enabled in prototype' },
    'common.noSecret': { ar: 'القيم السرية لا تظهر أبداً؛ يُعرض اسم المفتاح وحالته فقط.', en: 'Secret values are never shown; only key names and configured state.' },
    'common.notBilling': { ar: 'أرقام تقديرية وليست للفوترة.', en: 'Estimates, not billing-grade.' },
    'status.planning': { ar: 'تخطيط', en: 'Planning' },
    'status.running': { ar: 'قيد التشغيل', en: 'Running' },
    'status.paused': { ar: 'متوقف مؤقتاً', en: 'Paused' },
    'status.awaiting_approval': { ar: 'بانتظار الموافقة', en: 'Awaiting approval' },
    'status.completed': { ar: 'مكتمل', en: 'Completed' },
    'status.failed': { ar: 'فشل', en: 'Failed' },
    'status.cancelled': { ar: 'ملغى', en: 'Cancelled' },
    'task.created': { ar: 'أُنشئت', en: 'Created' },
    'task.planned': { ar: 'مخططة', en: 'Planned' },
    'task.assigned': { ar: 'مسندة', en: 'Assigned' },
    'task.running': { ar: 'قيد التنفيذ', en: 'Running' },
    'task.reviewing': { ar: 'قيد المراجعة', en: 'Reviewing' },
    'task.completed': { ar: 'مكتملة', en: 'Completed' },
    'task.failed': { ar: 'فشلت', en: 'Failed' },
    'task.blocked': { ar: 'محظورة', en: 'Blocked' },
    'task.cancelled': { ar: 'ملغاة', en: 'Cancelled' },
    'outcome.verified': { ar: 'تم التحقق', en: 'Verified' },
    'outcome.partially_verified': { ar: 'تم التحقق جزئياً', en: 'Partially verified' },
    'outcome.unverified': { ar: 'غير متحقق', en: 'Unverified' },
    'outcome.failed': { ar: 'فشل', en: 'Failed' },
    'outcome.blocked': { ar: 'محظور', en: 'Blocked' },
    'outcome.requires_human_review': { ar: 'يتطلب مراجعة بشرية', en: 'Requires human review' },
    'risk.high': { ar: 'خطورة عالية', en: 'High risk' },
    'risk.medium': { ar: 'خطورة متوسطة', en: 'Medium risk' },
    'risk.low': { ar: 'خطورة منخفضة', en: 'Low risk' },
    'phase.understand': { ar: 'الفهم', en: 'Understand' },
    'phase.plan': { ar: 'التخطيط', en: 'Plan' },
    'phase.assign': { ar: 'الإسناد', en: 'Assign' },
    'phase.execute': { ar: 'التنفيذ', en: 'Execute' },
    'phase.verify': { ar: 'التحقق', en: 'Verify' },
    'phase.deliver': { ar: 'التسليم', en: 'Deliver' }
  });

  Object.assign(STR, {
    'run.mission': { ar: 'مهمة', en: 'Mission' },
    'run.next': { ar: 'التالي', en: 'Next' },
    'run.nextApproval': { ar: 'اعتمد أو ارفض تنفيذ اختبار Node حتى يتمكن QA من التحقق من مجموعة الاختبارات.', en: 'Approve or reject the Node test execution so QA can verify the suite.' },
    'run.nextNoAction': { ar: 'WORA تعمل دون الحاجة إلى إجراء بشري.', en: 'WORA is operating; no human action is required.' },
    'run.progress': { ar: '{done} من {total} مهام مكتملة', en: '{done} of {total} tasks complete' },
    'run.plan': { ar: 'الخطة', en: 'Plan' },
    'run.activity': { ar: 'النشاط', en: 'Activity' },
    'run.evidence': { ar: 'الأدلة', en: 'Evidence' },
    'run.artifact': { ar: 'المخرج', en: 'Artifact' },
    'run.context': { ar: 'السياق', en: 'Context' },
    'run.strategy': { ar: 'الاستراتيجية', en: 'Strategy' },
    'run.planVersion': { ar: 'نسخة الخطة', en: 'Plan version' },
    'run.taskLedger': { ar: 'سجل المهام', en: 'Task ledger' },
    'run.taskLedgerHint': { ar: 'كل صف هو وحدة عمل قابلة للفحص.', en: 'Every row is an inspectable unit of work.' },
    'run.openApprovals': { ar: 'فتح الموافقات', en: 'Open approvals' },
    'run.reviewApproval': { ar: 'مراجعة الموافقة', en: 'Review approval' },
    'run.inspectTask': { ar: 'فحص المهمة', en: 'Inspect task' },
    'run.pendingApproval': { ar: 'موافقة معلّقة', en: 'Pending approval' },
    'run.approvalWaiting': { ar: 'إجراء عالي الخطورة بانتظار قرارك', en: 'A high-risk action is waiting for your decision' },
    'run.approvalCopy': { ar: 'تشغيل اختبارات Node داخل مساحة العمل. لن يبدأ QA حتى يتم الاعتماد أو الرفض.', en: 'Run Node tests inside the workspace. QA cannot start until this is approved or rejected.' },
    'run.testExecution': { ar: 'تنفيذ اختبار Node', en: 'Node test execution' },
    'run.outcomeReview': { ar: 'النتيجة تتطلب مراجعة', en: 'Outcome requires review' },
    'run.outcomeReviewCopy': { ar: 'اكتملت 3 من 4 مهام، لكن مهمة التحقق من مجموعة الاختبارات محظورة. المخرج موجود، لكن النتيجة لم تُتحقق بالكامل.', en: '3 of 4 tasks completed, but the test-suite task is blocked. The artifact exists, but the outcome is not fully verified.' },
    'run.noApproval': { ar: 'لا توجد موافقات معلّقة', en: 'No pending approvals' },
    'run.phaseHint': { ar: 'المرحلة مشتقة من بيانات المهمة الحقيقية، وليست شريط تقدم تجميلياً.', en: 'The phase is derived from real mission data, not a decorative progress bar.' },
    'run.unknown': { ar: 'غير متاح', en: 'Not exposed' },
    'plan.tasks': { ar: 'مهمة', en: 'tasks' },
    'plan.dependencies': { ar: 'التبعيات', en: 'Dependencies' },
    'plan.noDependencies': { ar: 'لا تبعيات', en: 'No dependencies' },
    'plan.assignment': { ar: 'الإسناد', en: 'Assignment' },
    'plan.blockedReason': { ar: 'سبب الحظر', en: 'Blocked reason' },
    'plan.acceptance': { ar: 'معايير القبول', en: 'Acceptance criteria' },
    'plan.toolInput': { ar: 'مدخلات الأداة', en: 'Tool input' },
    'plan.capability': { ar: 'لقطة القدرات', en: 'Capability snapshot' },
    'plan.noSnapshot': { ar: 'لا توجد لقطة قدرات — لم تبدأ المهمة.', en: 'No capability snapshot — the task has not started.' },
    'plan.dependenciesHint': { ar: 'التبعيات معروضة من dependsOn فقط؛ لا يوجد رسم بياني مخترع.', en: 'Dependencies come from dependsOn only; no graph is invented.' },
    'activity.title': { ar: 'سجل التشغيل', en: 'Run stream' },
    'activity.hint': { ar: 'ما حدث، بالترتيب. لا توجد محاكاة كتابة أو طرفية وهمية.', en: 'What happened, in order. No fake typing or shell.' },
    'activity.all': { ar: 'الكل', en: 'All' },
    'activity.execution': { ar: 'التنفيذ', en: 'Execution' },
    'activity.handoff': { ar: 'التسليم بين الوكلاء', en: 'Handoffs' },
    'activity.governance': { ar: 'الحوكمة', en: 'Governance' },
    'activity.verification': { ar: 'التحقق', en: 'Verification' },
    'activity.taskCreated': { ar: 'أُنشئت مهمة: {title}', en: 'Task created: {title}' },
    'activity.attempt': { ar: 'المحاولة {n}: {summary}', en: 'Attempt {n}: {summary}' },
    'activity.handoffEvent': { ar: 'تسليم من {from} إلى {to}', en: 'Handoff from {from} to {to}' },
    'activity.approvalRequested': { ar: 'طُلبت موافقة: {summary}', en: 'Approval requested: {summary}' },
    'activity.verificationEvent': { ar: 'تحقق {result} بواسطة {verifier}', en: 'Verification {result} by {verifier}' },
    'activity.outcomeEvent': { ar: 'نتيجة المهمة: {status}', en: 'Mission outcome: {status}' },
    'activity.artifactEvent': { ar: 'تم إنتاج المخرج: {name}', en: 'Artifact produced: {name}' },
    'activity.empty': { ar: 'لا توجد أحداث في هذا التصنيف.', en: 'No events in this filter.' },
    'evidence.title': { ar: 'سلسلة الأدلة', en: 'Evidence chain' },
    'evidence.hint': { ar: 'ما الذي يجعل النتيجة موثوقة — وما الذي يمنع اعتمادها الآن.', en: 'What makes the result credible — and what prevents sign-off now.' },
    'evidence.outcome': { ar: 'حكم النتيجة', en: 'Outcome verdict' },
    'evidence.checks': { ar: 'فحوصات النتيجة', en: 'Outcome checks' },
    'evidence.taskEvidence': { ar: 'أدلة المهام', en: 'Task evidence' },
    'evidence.passed': { ar: 'ناجح', en: 'Passed' },
    'evidence.failed': { ar: 'فاشل', en: 'Failed' },
    'evidence.notRun': { ar: 'لم يُنفّذ', en: 'Not run' },
    'evidence.independent': { ar: 'مستقل', en: 'Independent' },
    'evidence.noRuns': { ar: 'لا توجد محاولات مسجلة.', en: 'No runs recorded.' },
    'evidence.reasons': { ar: 'أسباب القرار', en: 'Reasons' },
    'evidence.generated': { ar: 'أُنشئ', en: 'Generated' },
    'evidence.expected': { ar: 'المتوقع', en: 'Expected' },
    'evidence.actual': { ar: 'الفعلي', en: 'Actual' },
    'evidence.verifications': { ar: 'سجلات التحقق', en: 'Verification records' },
    'evidence.noVerification': { ar: 'لا يوجد سجل تحقق لهذه المهمة.', en: 'No verification record for this task.' },
    'artifact.title': { ar: 'المخرج', en: 'Artifact' },
    'artifact.hint': { ar: 'التسليم النهائي للمهمة، معروض كما هو.', en: 'The mission deliverable, shown as delivered.' },
    'artifact.open': { ar: 'فتح المخرج', en: 'Open artifact' },
    'artifact.download': { ar: 'تنزيل', en: 'Download' },
    'artifact.raw': { ar: 'عرض الخام', en: 'Show raw' },
    'artifact.rendered': { ar: 'عرض منسّق', en: 'Rendered' },
    'artifact.noArtifact': { ar: 'لم يتم إنتاج مخرج بعد.', en: 'No artifact has been produced yet.' },
    'artifact.noArtifactBody': { ar: 'سيظهر المخرج هنا عند اكتمال المهمة.', en: 'The deliverable will appear here when the mission completes.' },
    'artifact.sourceNote': { ar: 'المخرج نص Markdown حقيقي من واجهة البرمجة، وليس محتوى تجريبياً.', en: 'This is real Markdown from the API, not prototype content.' },
    'context.title': { ar: 'سياق المهمة', en: 'Mission context' },
    'context.hint': { ar: 'ما فهمته WORA، وكيف وزّعت الصلاحيات والقدرات.', en: 'What WORA understood, and how it resolved authority and capability.' },
    'context.problem': { ar: 'نموذج المشكلة', en: 'Problem model' },
    'context.reasoning': { ar: 'الاستدلال', en: 'Reasoning' },
    'context.capabilities': { ar: 'لقطات القدرات', en: 'Capability snapshots' },
    'context.runtime': { ar: 'زمن التشغيل', en: 'Runtime' },
    'context.domain': { ar: 'المجال', en: 'Domain' },
    'context.confidence': { ar: 'الثقة', en: 'Confidence' },
    'context.sufficient': { ar: 'كافٍ للمتابعة', en: 'Sufficient to proceed' },
    'context.unknowns': { ar: 'المجهولات', en: 'Unknowns' },
    'context.limitations': { ar: 'القيود', en: 'Limitations' },
    'context.resolved': { ar: 'تم الحل', en: 'Resolved' },
    'context.noSnapshot': { ar: 'لا توجد لقطة قدرات لهذه المهمة.', en: 'No capability snapshot for this task.' },
    'context.noSkills': { ar: 'لا مهارات مسندة', en: 'No skills assigned' },
    'context.noPlugins': { ar: 'لا إضافات مسندة', en: 'No plugins assigned' }
  });

  Object.assign(STR, {
    'zone.navigation': { ar: 'أقسام التشغيل', en: 'Operating zones' },
    'status.active': { ar: 'نشط', en: 'Active' },
    'status.inactive': { ar: 'غير نشط', en: 'Inactive' },
    'status.suspended': { ar: 'موقوف', en: 'Suspended' },
    'common.yes': { ar: 'نعم', en: 'Yes' },
    'common.no': { ar: 'لا', en: 'No' },
    'common.enabled': { ar: 'مفعّل', en: 'Enabled' },
    'common.disabled': { ar: 'معطّل', en: 'Disabled' },
    'common.resumable': { ar: 'قابلة للاستئناف', en: 'Resumable' },
    'common.notResumable': { ar: 'غير قابلة للاستئناف', en: 'Not resumable' },
    'status.pending': { ar: 'معلّق', en: 'Pending' },
    'status.approved': { ar: 'معتمد', en: 'Approved' },
    'status.rejected': { ar: 'مرفوض', en: 'Rejected' },
    'marketStatus.ready': { ar: 'جاهز', en: 'Ready' },
    'runtime.durableShort': { ar: 'دائم', en: 'Durable' },
    'runtime.ephemeralShort': { ar: 'مؤقت', en: 'Ephemeral' },
    'runtime.durableStore': { ar: 'مخزن دائم', en: 'Durable store' },
    'runtime.ephemeralStore': { ar: 'مخزن مؤقت', en: 'Ephemeral store' },
    'runtime.activeLeases': { ar: '{n} أقفال نشطة', en: '{n} active leases' },
    'runtime.blocked': { ar: '{n} محظورة', en: '{n} blocked' },
    'runtime.approval': { ar: '{n} موافقة', en: '{n} approval' },
    'runtime.maxTasks': { ar: '{n} أقصى مهام', en: '{n} max tasks' },
    'runtime.lease': { ar: 'قفل {n} ث', en: 'lease {n}s' },
    'runtime.recorded': { ar: 'مسجل {time}', en: 'recorded {time}' },
    'runtime.optInWorker': { ar: 'عامل اختياري', en: 'Opt-in worker' },
    'runtime.sqliteWorkers': { ar: 'مدعوم مع تسلسل SQLite', en: 'Supported with SQLite serialization' },
    'common.secondsShort': { ar: ' ث', en: 's' },
    'run.humanReview': { ar: 'مراجعة بشرية', en: 'Human review' },
    'run.confidence': { ar: 'ثقة', en: 'confidence' },
    'run.artifactReadyShort': { ar: 'المخرج جاهز', en: 'Artifact ready' },
    'marketStatus.syncing': { ar: 'قيد المزامنة', en: 'Syncing' },
    'marketStatus.error': { ar: 'خطأ', en: 'Error' },
    'cap.registrySummary': { ar: '{agents} وكيلاً و{n} حزمة في السجل. لا تُثبّت الحزم تلقائياً.', en: '{agents} agents and {n} packages in the registry. Packages are not installed automatically.' },
    'cap.registrySource': { ar: 'المصدر الرسمي مدمج: bundled://wora-official', en: 'Official bundled source: bundled://wora-official' },
    'cap.selectAgentTitle': { ar: 'اختر وكيلاً لفحص ملفه', en: 'Select an agent to inspect its profile' },
    'cap.selectAgentDesc': { ar: 'كل وكيل يعلن مهاراته وأدواته وصلاحياته.', en: 'Each agent declares its skills, tools, and permissions.' },
    'cap.mcp': { ar: 'MCP', en: 'MCP' },
    'cap.mcpEmpty': { ar: 'لا توجد خوادم MCP مسجّلة في هذه اللقطة.', en: 'No MCP servers are registered in this snapshot.' },
    'cap.mcpInspectorTitle': { ar: 'لا اتصالات MCP', en: 'No MCP connections' },
    'cap.mcpInspectorDesc': { ar: 'اللقطة لا تحتوي خوادم MCP. الإضافة تتطلب مسار تثبيت مصرّحاً به.', en: 'The snapshot has no MCP servers. Adding one requires an authorized install path.' },
    'library.memoryInspectorTitle': { ar: 'سجل ذاكرة المهمة', en: 'Mission memory log' },
    'library.memoryNote': { ar: 'سجل محلي مشتق من أحداث المهام؛ للقراءة فقط، ولا يعرض القيم السرية.', en: 'A local log derived from task events; read-only, and it never exposes secret values.' },
    'library.knowledgeNote': { ar: 'المعرفة تُدار عبر سجل القدرات.', en: 'Knowledge is managed through the capability registry.' },
    'library.knowledgeBody': { ar: 'لا يعرض هذا النموذج سطح معرفة منفصلاً. افتح القدرات لفحص المهارات والصلاحيات والمصدر.', en: 'This prototype does not expose a separate knowledge surface. Open Capabilities to inspect skills, permissions, and source.' },
    'system.pricingNote': { ar: 'تقديرات الرموز = الأحرف/4؛ والتكلفة من كتالوج تقديري مدمج يمكن تجاوزه عبر WORA_PRICE_JSON. ليست للفوترة.', en: 'Token figures are char/4 estimates; cost uses an approximate built-in catalog overridable via WORA_PRICE_JSON. Not billing-grade.' },
    'scope.instance': { ar: 'المثيل', en: 'Instance' },
    'scope.organization': { ar: 'المؤسسة', en: 'Organization' },
    'scope.project': { ar: 'المشروع', en: 'Project' },
    'scope.agent': { ar: 'الوكيل', en: 'Agent' },
    'scope.user': { ar: 'المستخدم', en: 'User' },
    'pkgType.knowledge': { ar: 'معرفة', en: 'Knowledge' },
    'pkgType.task': { ar: 'مهمة', en: 'Task' },
    'pkgType.tool': { ar: 'أداة', en: 'Tool' },
    'pkgType.workflow': { ar: 'سير عمل', en: 'Workflow' },
    'execModel.instructions-only': { ar: 'تعليمات فقط', en: 'Instructions only' },
    'execModel.mcp': { ar: 'خادم MCP', en: 'MCP server' },
    'execModel.http': { ar: 'تكامل HTTP', en: 'HTTP integration' },
    'execModel.sandboxed': { ar: 'بيئة معزولة', en: 'Sandboxed' },
    'inspector.hint': { ar: 'يشرح العنصر المحدد دون مغادرة المهمة.', en: 'Explains the selected object without leaving the mission.' },
    'runtime.lim1': { ar: 'SQLite WAL يُسلسل الكتابة؛ العمال عملاء كتابة منفصلون تحميهم أقفال المهام، وليس طابوراً موزعاً.', en: 'SQLite WAL serializes writes; workers are separate write clients protected by mission and task leases, not a distributed queue.' },
    'runtime.lim2': { ar: 'أقفال المهام تمنع عاملين من تنفيذ المهمة نفسها، لكن لا يوجد إجماع أو طابور بين المضيفين.', en: 'Mission leases prevent two workers from executing the same mission, but there is no cross-host consensus or queue.' },
    'runtime.lim3': { ar: 'العامل الذي يُقتل أثناء أداة يترك نقطة تحقق مبدوءة؛ الأدوات المتكررة قد تعيد المحاولة، والأدوات ذات الآثار الجانبية تتطلب مراجعة يدوية.', en: 'A worker process killed mid-tool leaves a started checkpoint; idempotent tools may retry, side-effecting tools require manual review.' },
    'runtime.lim4': { ar: 'لا يلزم طابور مدفوع أو خدمة خارجية، ولا يوجد أي منهما مُعد.', en: 'No paid queue or external service is required or configured.' },
    'run.summaryPending': { ar: 'اكتملت {done} من {total} مهام. مهمة التحقق من مجموعة الاختبارات محظورة بانتظار موافقة عالية الخطورة، لذلك بقيت النتيجة غير متحققة رغم وجود المخرج.', en: '{done} of {total} tasks completed. The test-suite task is blocked on a high-risk approval, so the outcome remains unverified even though the artifact exists.' },
    'run.artifactReady': { ar: 'المخرج جاهز · بانتظار الاعتماد', en: 'Artifact ready · awaiting sign-off' }
  });

  const limitationText = (text) => {
    const map = {
      'SQLite WAL serializes writes; workers are separate write clients protected by mission and task leases, not a distributed queue.': 'runtime.lim1',
      'Mission leases prevent two workers from executing the same mission, but there is no cross-host consensus or queue.': 'runtime.lim2',
      'A worker process killed mid-tool leaves a started checkpoint; idempotent tools may retry, side-effecting tools require manual review.': 'runtime.lim3',
      'No paid queue or external service is required or configured.': 'runtime.lim4'
    };
    return map[text] ? t(map[text]) : text;
  };

  const ICONS = {
    pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    play: '<path d="m7 4 13 8-13 8Z"/>',
    library: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/>',
    layers: '<path d="m12 2 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/>',
    sliders: '<path d="M4 21v-7"/><path d="M4 10V3"/><path d="M12 21v-9"/><path d="M12 8V3"/><path d="M20 21v-5"/><path d="M20 12V3"/><path d="M1 14h6"/><path d="M9 8h6"/><path d="M17 16h6"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
    command: '<path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 0 0-3-3Z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
    moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18Z"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/>',
    alert: '<path d="M10.3 3.9 2.8 17a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>',
    check: '<path d="m20 6-11 11-5-5"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    chevronRight: '<path d="m9 18 6-6-6-6"/>',
    chevronLeft: '<path d="m15 18-6-6 6-6"/>',
    chevronDown: '<path d="m6 9 6 6 6-6"/>',
    arrowRight: '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="1"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    bot: '<rect x="4" y="8" width="16" height="12" rx="2"/><path d="M12 8V4M8 4h8"/><path d="M9 14h.01M15 14h.01"/>',
    package: '<path d="m16.5 9.4-9-5.2M21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="M3.3 7 12 12l8.7-5M12 22V12"/>',
    plug: '<path d="M12 22v-5M9 8V2M15 8V2M6 8h12v3a6 6 0 0 1-12 0Z"/>',
    database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v7c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12v7c0 1.7 3.6 3 8 3s8-1.3 8-3v-7"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h5"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    terminal: '<rect x="3" y="4" width="18" height="16" rx="1"/><path d="m7 9 3 3-3 3M13 15h4"/>',
    circle: '<circle cx="12" cy="12" r="8"/>',
    external: '<path d="M15 3h6v6M10 14 21 3"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
    git: '<circle cx="6" cy="6" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="12" cy="18" r="2"/><path d="M6 8v3c0 2 2 3 4 3h4c2 0 4-1 4-3V8M12 14v2"/>',
    lock: '<rect x="4" y="10" width="16" height="11" rx="1"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    activity: '<path d="M3 12h4l3 8 4-16 3 8h4"/>',
    more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>'
  };
  const icon = (name, size = 16, cls = '') => `<svg class="${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.circle}</svg>`;
  const selectedTask = () => M?.tasks.find((task) => task.id === state.selectedTaskId) || null;
  const selectedAgent = () => D?.agents.find((agent) => agent.id === state.selectedAgentId) || null;
  const selectedPackage = () => D?.packages.find((pkg) => pkg.id === state.selectedPackageId) || null;
  const pendingApproval = () => M?.approvals.find((approval) => approval.status === 'pending') || null;
  const blockedTask = () => M?.tasks.find((task) => task.status === 'blocked') || null;
  const completedTasks = () => M?.tasks.filter((task) => task.status === 'completed') || [];
  const taskCount = () => M?.tasks.length || 0;
  const missionProgress = () => pct(completedTasks().length, taskCount());
  const snapshotFor = (taskId) => M?.capabilitySnapshots.find((snap) => snap.taskId === taskId) || null;

  const toneFor = (value) => {
    if (['completed', 'verified', 'ready', 'active', 'ok', 'passed', 'official'].includes(value)) return 'success';
    if (['failed', 'cancelled', 'revoked', 'error', 'untrusted', 'denied'].includes(value)) return 'danger';
    if (['awaiting_approval', 'blocked', 'requires_human_review', 'pending', 'warning', 'unverified', 'partially_verified', 'community'].includes(value)) return 'signal';
    if (['running', 'planning', 'paused', 'brand'].includes(value)) return 'brand';
    return 'neutral';
  };
  const statusLabel = (status) => t(`status.${status}`) !== `status.${status}` ? t(`status.${status}`) : strip(status);
  const taskLabel = (status) => t(`task.${status}`) !== `task.${status}` ? t(`task.${status}`) : strip(status);
  const outcomeLabel = (status) => t(`outcome.${status}`) !== `outcome.${status}` ? t(`outcome.${status}`) : strip(status);
  const riskLabel = (risk) => t(`risk.${risk}`) !== `risk.${risk}` ? t(`risk.${risk}`) : strip(risk);
  const badge = (label, tone = 'neutral', dot = false) => `<span class="badge badge-${tone}">${dot ? '<i class="dot"></i>' : ''}${esc(label)}</span>`;
  const statusBadge = (status) => badge(statusLabel(status), toneFor(status), true);
  const taskBadge = (status) => badge(taskLabel(status), toneFor(status), true);
  const riskBadge = (risk) => `<span class="risk risk-${esc(risk)}">${icon(risk === 'high' ? 'alert' : 'shield', 12)}${esc(riskLabel(risk))}</span>`;

  const phaseData = () => {
    if (!M) return [];
    const tasks = M.tasks || [];
    const assigned = tasks.length > 0 && tasks.every((task) => task.agent || task.specialization);
    const blocked = tasks.some((task) => task.status === 'blocked');
    const running = tasks.some((task) => ['running', 'reviewing'].includes(task.status));
    const outcome = M.outcomeVerification?.status || M.outcomeStatus;
    const artifact = Boolean(M.artifactId || M.artifacts?.length);
    const allComplete = tasks.length > 0 && tasks.every((task) => task.status === 'completed');
    return [
      { id: 'understand', state: M.problemProfile ? 'complete' : 'next' },
      { id: 'plan', state: M.planVersions?.length || M.composition ? 'complete' : 'next' },
      { id: 'assign', state: assigned ? 'complete' : 'next' },
      { id: 'execute', state: blocked ? 'blocked' : allComplete ? 'complete' : running ? 'current' : 'current' },
      { id: 'verify', state: outcome === 'verified' ? 'complete' : outcome && outcome !== 'unverified' ? 'blocked' : running ? 'current' : 'next' },
      { id: 'deliver', state: artifact ? (outcome === 'verified' ? 'complete' : 'blocked') : 'next' }
    ];
  };

  const phaseCaption = (id) => {
    if (id === 'understand') return M?.problemProfile ? `${Math.round((M.problemProfile.confidence || 0) * 100)}% ${t('run.confidence')}` : t('run.unknown');
    if (id === 'plan') return M?.planVersions?.[0]?.strategy || t('run.unknown');
    if (id === 'assign') return `${M?.tasks.length || 0} ${t('common.tasks')}`;
    if (id === 'execute') return `${completedTasks().length}/${taskCount()}`;
    if (id === 'verify') return M?.outcomeStatus === 'requires_human_review' ? t('run.humanReview') : M?.outcomeStatus ? outcomeLabel(M.outcomeStatus) : t('run.unknown');
    return D?.artifact?.name ? (M?.outcomeStatus === 'verified' ? D.artifact.name : t('run.artifactReadyShort')) : t('run.unknown');
  };

  const buildEvents = () => {
    if (!M) return [];
    const events = [];
    for (const task of M.tasks) {
      events.push({ id: `task-${task.id}`, at: task.createdAt, type: 'execution', tone: 'neutral', title: t('activity.taskCreated', { title: task.title }), detail: `${task.agent?.name || t('common.none')} · ${task.specialization}` });
      for (const run of task.runs || []) {
        events.push({ id: `run-${run.id}`, at: run.finishedAt || run.startedAt, type: 'execution', tone: run.status === 'completed' ? 'success' : run.status === 'failed' ? 'danger' : 'brand', title: t('activity.attempt', { n: run.attempt, summary: run.summary || task.title }), detail: `${task.tool || t('common.none')} · ${run.evidence?.length || 0} evidence` });
      }
    }
    for (const handoff of M.handoffs || []) events.push({ id: `handoff-${handoff.id}`, at: handoff.createdAt, type: 'handoff', tone: 'brand', title: t('activity.handoffEvent', { from: handoff.from, to: handoff.to }), detail: 'handoff contract recorded' });
    for (const approval of M.approvals || []) events.push({ id: `approval-${approval.id}`, at: approval.decidedAt || approval.createdAt, type: 'governance', tone: approval.status === 'pending' ? 'signal' : approval.status === 'approved' ? 'success' : 'danger', title: t('activity.approvalRequested', { summary: approval.actionSummary }), detail: `${approval.toolId || approval.kind} · ${riskLabel(approval.risk)} · ${t('status.' + approval.status)}` });
    for (const verification of M.verifications || []) events.push({ id: `verify-${verification.id}`, at: verification.createdAt, type: 'verification', tone: verification.result === 'passed' ? 'success' : 'danger', title: t('activity.verificationEvent', { result: verification.result, verifier: verification.verifier }), detail: verification.independence });
    if (M.outcomeVerification) events.push({ id: 'outcome', at: M.outcomeVerification.generatedAt, type: 'verification', tone: M.outcomeVerification.status === 'verified' ? 'success' : 'signal', title: t('activity.outcomeEvent', { status: outcomeLabel(M.outcomeStatus || M.outcomeVerification.status) }), detail: (M.outcomeVerification.reasons || []).slice(0, 2).join(' · ') });
    if (M.artifact) events.push({ id: 'artifact', at: M.artifact.createdAt, type: 'delivery', tone: 'success', title: t('activity.artifactEvent', { name: M.artifact.name }), detail: M.artifact.kind });
    return events.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  };

  const onMission = (agentId) => (M?.tasks || []).some((task) => task.agentId === agentId);

  const renderTopbar = () => {
    const pending = D?.state?.approvals?.pending || 0;
    const active = M?.objective || t('zone.noMission');
    $('#topbar').innerHTML = `
      <button class="brand" type="button" data-action="go" data-zone="brief" aria-label="WORA — ${esc(t('app.tagline'))}">
        <span class="brand-mark">W</span>
        <span class="brand-copy"><span class="brand-word">WORA</span><span class="brand-sub">${esc(t('app.tagline'))}</span></span>
      </button>
      <span class="topbar-sep" aria-hidden="true"></span>
      <button class="mission-chip" type="button" data-action="mission-switcher" aria-haspopup="dialog">
        ${M ? statusBadge(M.status) : '<span class="badge">' + esc(t('zone.noMission')) + '</span>'}
        <span class="mission-chip-title" dir="auto">${esc(active)}</span>
        ${icon('chevronDown', 13, 'muted')}
      </button>
      <div class="topbar-actions">
        <button class="command-button" type="button" data-action="palette" aria-label="${esc(t('app.command'))}">${icon('search', 14)}<span>${esc(t('common.search'))}</span><kbd>Ctrl K</kbd></button>
        <button class="attention-chip" type="button" data-action="open-approval" aria-label="${esc(t('zone.attention'))}">
          ${icon('alert', 13)}<span class="label">${esc(t('zone.attention'))}</span><span class="count">${pending}</span>
        </button>
        <span class="runtime-chip ${D?.runtime?.recovery?.blockedTasks ? 'warn' : ''}" title="${esc(D?.runtime?.mode || '')}">${icon('database', 13)}<span class="dot"></span><span>${D?.runtime?.durableStore ? t('runtime.durableShort') : t('runtime.ephemeralShort')}</span></span>
        <button class="locale-button" type="button" data-action="toggle-lang" aria-label="${esc(t('app.languageLabel'))}">${esc(t('app.language'))}</button>
        <button class="icon-button" type="button" data-action="toggle-theme" aria-label="${esc(state.theme === 'dark' ? t('app.light') : t('app.dark'))}" title="${esc(state.theme === 'dark' ? t('app.light') : t('app.dark'))}">${icon(state.theme === 'dark' ? 'sun' : 'moon')}</button>
      </div>`;
  };

  const navItems = () => [
    { id: 'brief', icon: 'pen', label: t('zone.brief') },
    { id: 'run', icon: 'play', label: t('zone.run'), count: blockedTask() ? 1 : 0 },
    { id: 'library', icon: 'library', label: t('zone.library'), count: D?.state?.artifacts || 0 },
    { id: 'capabilities', icon: 'layers', label: t('zone.capabilities'), count: D?.packages?.length || 0 },
    { id: 'system', icon: 'sliders', label: t('zone.system'), count: D?.state?.approvals?.pending || 0 }
  ];

  const renderRail = () => {
    const items = navItems();
    $('#rail').innerHTML = `
      <p class="rail-section-label">${esc(t('zone.navigation'))}</p>
      <div class="rail-zone-nav">
        ${items.map((item) => `<button class="rail-zone" type="button" data-action="go" data-zone="${item.id}" ${state.zone === item.id ? 'aria-current="page"' : ''} aria-label="${esc(item.label)}">${icon(item.icon, 17)}<span class="rail-zone-label">${esc(item.label)}</span>${item.count ? `<span class="rail-zone-count">${num(item.count)}</span>` : ''}</button>`).join('')}
      </div>
      <p class="rail-section-label">${esc(t('zone.activeMission'))}</p>
      ${M ? `<button class="rail-mission" type="button" data-action="mission-switcher">
        <span class="rail-mission-head">${statusBadge(M.status)}<span class="mono faint">${missionProgress()}%</span></span>
        <span class="rail-mission-title" dir="auto">${esc(M.objective)}</span>
        <span class="rail-progress"><span style="inline-size:${missionProgress()}%"></span></span>
        <span class="rail-mission-meta"><span>${completedTasks().length}/${taskCount()}</span><span>${esc(M.id.slice(0, 11))}…</span></span>
      </button>` : `<div class="rail-mission"><span class="rail-mission-title">${esc(t('zone.noMission'))}</span><button class="text-link" data-action="go" data-zone="brief">${esc(t('zone.brief'))} ${icon('arrowRight', 12)}</button></div>`}
      <div class="rail-foot">
        <p class="rail-foot-title">${esc(t('app.prototype'))}</p>
        <p class="rail-foot-copy">${esc(t('app.noMutation'))}</p>
        <p class="source">recorded ${esc((D?.capturedAt || '').slice(0, 10))}</p>
      </div>`;
  };

  const renderMobileNav = () => {
    const items = navItems();
    $('#mobile-nav').innerHTML = items.map((item) => `<button type="button" data-action="go" data-zone="${item.id}" ${state.zone === item.id ? 'aria-current="page"' : ''}>${icon(item.icon, 19)}<span>${esc(item.label)}</span>${item.id === 'system' && item.count ? `<span class="nav-badge">${num(item.count)}</span>` : ''}</button>`).join('');
  };

  const renderRuntimeStrip = () => {
    const rt = D?.runtime || {};
    const st = D?.state || {};
    $('#runtime-strip').innerHTML = `
      <span><b>${esc(rt.mode || 'runtime')}</b></span>
      <span>${rt.durableStore ? t('runtime.durableStore') : t('runtime.ephemeralStore')}</span>
      <span>${t('runtime.activeLeases', { n: num(rt.activeLeases || 0) })}</span>
      <span>${t('runtime.blocked', { n: num(st.tasks?.blocked || 0) })}</span>
      <span class="warn">${t('runtime.approval', { n: num(st.approvals?.pending || 0) })}</span>
      <span class="spacer"></span>
      <span>${t('runtime.maxTasks', { n: num(rt.limits?.maxConcurrentTasks || 0) })}</span>
      <span>${t('runtime.lease', { n: Math.round((rt.limits?.leaseTtlMs || 0) / 1000) })}</span>
      <span class="live">${t('runtime.recorded', { time: esc((D?.capturedAt || '').replace('T', ' ').slice(0, 16)) })}</span>`;
  };

  const renderBrief = () => {
    const st = D.state;
    const tools = D.coreTools?.length || 0;
    const packages = D.packages?.length || 0;
    return `<div class="page page-wide">
      <header class="brief-head">
        <div class="brief-head-copy">
          <p class="eyebrow">WORA / ${esc(t('zone.brief'))}</p>
          <h1 class="page-title">${esc(t('brief.title'))}</h1>
          <p class="page-deck">${esc(t('brief.deck'))}</p>
        </div>
        ${badge(t('app.prototype'), 'brand')}
      </header>
      <div class="readiness">
        <div class="readiness-row"><div class="readiness-value">${num(st.agents)}</div><div class="readiness-label">${esc(t('brief.agents'))}</div></div>
        <div class="readiness-row"><div class="readiness-value">${num(tools)}</div><div class="readiness-label">${esc(t('brief.tools'))}</div></div>
        <div class="readiness-row"><div class="readiness-value">${num(packages)}</div><div class="readiness-label">${esc(t('brief.packages'))}</div></div>
        <div class="readiness-row"><div class="readiness-value">${num(st.missions?.total || 0)}</div><div class="readiness-label">${esc(t('zone.activeMission'))}</div></div>
      </div>
      <section class="composer" aria-labelledby="composer-title">
        <div class="composer-top">${icon('pen', 13)}<span class="label" id="composer-title">${esc(t('brief.composerTitle'))}</span><span>·</span><span>${esc(t('brief.composerHint'))}</span></div>
        <label class="sr-only" for="brief-input">${esc(t('brief.placeholder'))}</label>
        <textarea id="brief-input" dir="auto" maxlength="1200" placeholder="${esc(t('brief.placeholder'))}"></textarea>
        <div class="composer-foot">
          <div class="composer-context">
            <span class="badge">${icon('shield', 11)} ${esc(t('brief.context'))}: ${num(st.agents)} ${esc(t('common.agents'))}</span>
            <span class="badge">${num(tools)} ${esc(t('common.tools'))}</span>
            <span class="badge">${num(packages)} ${esc(t('common.packages'))} · ${num(st.installed || 0)} ${esc(t('common.installed'))}</span>
          </div>
          <div class="composer-actions"><span class="composer-note">${esc(t('app.noMutation'))}</span><button class="btn btn-primary" type="button" data-action="preview-intent">${icon('play', 13)} ${esc(t('brief.submit'))}</button></div>
        </div>
      </section>
      <div class="examples"><span class="examples-label">${esc(t('brief.examples'))}</span>
        <button class="example" type="button" data-action="example" data-text="Build a production-ready web app and verify it with tests">${esc('Build a production-ready web app and verify it with tests')}</button>
        <button class="example" type="button" data-action="example" data-text="Analyze the release failure and produce a verified incident report">${esc('Analyze the release failure and produce a verified incident report')}</button>
        <button class="example" type="button" data-action="example" data-text="Design and run a decision model for the next quarter">${esc('Design and run a decision model for the next quarter')}</button>
      </div>
      <div class="brief-grid">
        <section>
          <div class="section-head"><h2>${esc(t('brief.recent'))}</h2><span class="aside">${num(st.missions?.total || 0)}</span></div>
          <div class="recent-list">
            ${M ? `<button class="recent-row" type="button" data-action="go" data-zone="run">
              <span><span class="recent-title" dir="auto">${esc(M.objective)}</span><span class="recent-meta"><span>${statusLabel(M.status)}</span><span>${completedTasks().length}/${taskCount()}</span><span>${esc(shortDate(M.updatedAt, state.locale))}</span></span></span>
              ${icon('arrowRight', 14, 'muted')}
            </button>` : `<div class="empty"><p>${esc(t('brief.recentEmpty'))}</p></div>`}
          </div>
          <div class="honest-note">${esc(t('brief.honest'))}</div>
        </section>
        <section>
          <div class="section-head"><h2>${esc(t('brief.how'))}</h2></div>
          <div class="how-list">
            ${[['how1', 'how1Copy'], ['how2', 'how2Copy'], ['how3', 'how3Copy'], ['how4', 'how4Copy']].map(([title, body], i) => `<div class="how-row"><span class="how-index">${pad(i + 1)}</span><div><strong>${esc(t('brief.' + title))}</strong><p>${esc(t('brief.' + body))}</p></div></div>`).join('')}
          </div>
        </section>
      </div>
    </div>`;
  };

  const renderRunHeader = () => {
    if (!M) {
      return `<header class="mission-head"><p class="eyebrow">${esc(t('run.mission'))}</p><h1 class="mission-title">${esc(t('zone.noMission'))}</h1><p class="page-deck">${esc(t('brief.noMissionBody'))}</p></header>`;
    }
    const pending = pendingApproval();
    const blocked = blockedTask();
    const phases = phaseData();
    return `<header class="mission-head">
      <div class="mission-eyebrow">
        <span class="eyebrow">${esc(t('run.mission'))}</span>
        <button class="mission-id" type="button" data-action="copy" data-copy="${esc(M.id)}" title="${esc(t('common.copy'))}">${esc(M.id)} ${icon('copy', 11)}</button>
      </div>
      <h1 class="mission-title" dir="auto">${esc(M.objective)}</h1>
      <p class="mission-summary" dir="auto">${esc(M.outcomeStatus === 'requires_human_review' ? t('run.summaryPending', { done: completedTasks().length, total: taskCount() }) : M.summary)}</p>
      <div class="mission-meta">
        ${statusBadge(M.status)}
        <span><span class="num">${completedTasks().length}/${taskCount()}</span> ${esc(t('common.tasks'))}</span>
        <span>${esc(t('run.strategy'))} <b class="mono">${esc(M.planVersions?.[0]?.strategy || t('run.unknown'))}</b></span>
        <span>${esc(t('common.updated'))} <b class="mono">${esc(shortDate(M.updatedAt, state.locale))}</b></span>
      </div>
      <div class="progress-line" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${missionProgress()}" aria-label="${esc(t('run.progress', { done: completedTasks().length, total: taskCount() }))}"><span style="inline-size:${missionProgress()}%"></span></div>
      <div class="progress-caption"><span>${esc(t('run.progress', { done: completedTasks().length, total: taskCount() }))}</span><span>${missionProgress()}%</span></div>
      <div class="phase-spine" aria-label="${esc(t('run.phaseHint'))}">
        ${phases.map((phase) => `<button class="phase" type="button" data-state="${phase.state}" data-action="phase" data-phase="${phase.id}" title="${esc(phaseCaption(phase.id))}"><span class="phase-dot"></span><span class="phase-label">${esc(t('phase.' + phase.id))}<small class="faint">${esc(phaseCaption(phase.id))}</small></span></button>`).join('')}
      </div>
      ${pending ? `<div class="attention" role="alert">
        <span class="attention-icon">${icon('alert', 18)}</span>
        <div>
          <div class="attention-title">${esc(t('run.approvalWaiting'))}</div>
          <div class="attention-copy">${esc(pending.actionSummary)}</div>
          <div class="attention-meta">${riskBadge(pending.risk)}<span class="mono faint">${esc(pending.toolId || pending.kind)}</span><span class="faint">·</span><span class="small muted">${esc(blocked?.title || '')}</span></div>
        </div>
        <div class="attention-actions"><button class="btn btn-small" type="button" data-action="open-approval">${esc(t('run.reviewApproval'))} ${icon('arrowRight', 12)}</button></div>
      </div>` : `<div class="attention" style="border-color:var(--line);background:var(--surface-3)">
        <span class="attention-icon" style="color:var(--success)">${icon('check', 18)}</span><div><div class="attention-title" style="color:var(--ink)">${esc(t('run.noApproval'))}</div><div class="attention-copy">${esc(t('run.nextNoAction'))}</div></div><div></div>
      </div>`}
      <div class="next-action"><span class="label">${esc(t('run.next'))}</span><span class="body">${pending ? `<strong>${esc(t('run.nextApproval'))}</strong>` : esc(t('run.nextNoAction'))}</span></div>
    </header>`;
  };

  const renderRunTabs = () => {
    const tabs = [['plan', 'run.plan'], ['activity', 'run.activity'], ['evidence', 'run.evidence'], ['artifact', 'run.artifact'], ['context', 'run.context']];
    return `<nav class="tabs" role="tablist" aria-label="${esc(t('zone.run'))}">
      ${tabs.map(([id, label]) => `<button class="tab" role="tab" type="button" data-action="tab" data-tab="${id}" aria-selected="${state.tab === id}">${esc(t(label))}${id === 'plan' ? `<span class="tab-count">${taskCount()}</span>` : id === 'evidence' ? `<span class="tab-count">${M?.verifications?.length || 0}</span>` : ''}</button>`).join('')}
    </nav>`;
  };

  const renderPlan = () => {
    const tasks = M?.tasks || [];
    return `<div class="tab-body">
      <div class="plan-meta">
        <span>${esc(t('run.planVersion'))} <b class="mono">${esc(M?.planVersions?.[0]?.version || '—')}</b></span>
        <span>${esc(t('run.strategy'))} <b>${esc(M?.planVersions?.[0]?.strategy || t('run.unknown'))}</b></span>
        <span>${esc(t('plan.dependenciesHint'))}</span>
      </div>
      <div class="section-head"><h2>${esc(t('run.taskLedger'))}</h2><span class="aside">${esc(t('run.taskLedgerHint'))}</span></div>
      <div class="ledger" role="list">
        <div class="ledger-head"><span>#</span><span>${esc(t('common.tasks'))}</span><span>${esc(t('plan.assignment'))}</span><span>${esc(t('common.status'))}</span></div>
        ${tasks.map((task) => `<div class="ledger-row ${state.selectedTaskId === task.id ? 'is-selected' : ''}" role="button" tabindex="0" data-action="select-task" data-id="${esc(task.id)}">
          <span class="ledger-index">${pad(task.orderIndex + 1)}</span>
          <span class="ledger-main"><span class="ledger-title" dir="auto">${esc(task.title)}</span><span class="ledger-sub"><span class="mono">${esc(task.tool || t('common.none'))}</span>${task.dependsOn?.length ? `<span>· ${esc(t('common.depends'))} ${task.dependsOn.length}</span>` : `<span>· ${esc(t('common.noDependencies'))}</span>`}</span></span>
          <span class="ledger-agent" dir="auto"><strong>${esc(task.agent?.name || t('common.none'))}</strong><small>${esc(task.specialization)}</small></span>
          <span class="ledger-status">${taskBadge(task.status)}${task.status === 'blocked' && pendingApproval() ? `<span class="action" role="button" tabindex="0" data-action="open-approval">${esc(t('common.review'))}</span>` : ''}</span>
        </div>`).join('')}
      </div>
    </div>`;
  };

  const renderActivity = () => {
    const filters = [['all', 'activity.all'], ['execution', 'activity.execution'], ['handoff', 'activity.handoff'], ['governance', 'activity.governance'], ['verification', 'activity.verification']];
    const events = buildEvents().filter((event) => state.activityFilter === 'all' || event.type === state.activityFilter);
    return `<div class="tab-body">
      <div class="section-head"><h2>${esc(t('activity.title'))}</h2><span class="aside">${esc(t('activity.hint'))}</span></div>
      <div class="timeline-filter">${filters.map(([id, key]) => `<button class="filter-chip" type="button" data-action="activity-filter" data-filter="${id}" aria-pressed="${state.activityFilter === id}">${esc(t(key))}</button>`).join('')}</div>
      ${events.length ? `<ol class="timeline">${events.map((event) => `<li class="timeline-item">
        <span class="timeline-marker" data-tone="${event.tone}"></span>
        <div class="timeline-copy"><div class="timeline-head"><strong class="timeline-title">${esc(event.title)}</strong><time class="timeline-time">${esc(date(event.at, state.locale))}</time></div><div class="timeline-detail">${esc(event.detail)}</div></div>
      </li>`).join('')}</ol>` : `<div class="empty"><h3>${esc(t('activity.empty'))}</h3></div>`}
    </div>`;
  };

  const checkIcon = (status) => `<span class="check-icon ${status === 'passed' ? 'pass' : status === 'failed' ? 'fail' : 'skip'}">${icon(status === 'passed' ? 'check' : status === 'failed' ? 'x' : 'circle', 12)}</span>`;

  const renderEvidence = () => {
    const outcome = M?.outcomeVerification;
    const checks = outcome?.checks || [];
    const verifications = M?.verifications || [];
    return `<div class="tab-body">
      <div class="section-head"><h2>${esc(t('evidence.title'))}</h2><span class="aside">${esc(t('evidence.hint'))}</span></div>
      <div class="verdict">
        <div><div class="eyebrow">${esc(t('evidence.outcome'))}</div><div class="verdict-status ${toneFor(outcome?.status || M?.outcomeStatus)}">${esc(outcomeLabel(outcome?.status || M?.outcomeStatus || 'unverified'))}</div><ul class="verdict-reasons">${(outcome?.reasons || []).map((reason) => `<li>${esc(reason)}</li>`).join('')}</ul></div>
        <div class="verdict-meta"><span class="mono">${esc(outcome?.generatedAt ? date(outcome.generatedAt, state.locale) : '—')}</span><br />${esc(t('evidence.generated'))}</div>
      </div>
      <div class="section-head" style="margin-block-start:22px"><h3>${esc(t('evidence.checks'))}</h3><span class="aside">${checks.filter((c) => c.status === 'passed').length}/${checks.length}</span></div>
      <div class="check-matrix">
        <div class="check-row matrix-head"><span></span><span>${esc(t('evidence.checks'))}</span><span style="justify-self:end">${esc(t('common.status'))}</span></div>
        ${checks.map((check) => `<div class="check-row"><span>${checkIcon(check.status)}</span><span><strong class="check-title">${esc(check.description)}</strong><span class="check-evidence">${esc(check.evidence)}</span></span><span class="check-state">${badge(check.status === 'passed' ? t('evidence.passed') : check.status === 'failed' ? t('evidence.failed') : t('evidence.notRun'), check.status === 'passed' ? 'success' : check.status === 'failed' ? 'danger' : 'neutral')}</span></div>`).join('')}
      </div>
      <div class="section-head" style="margin-block-start:26px"><h3>${esc(t('evidence.verifications'))}</h3><span class="aside">${verifications.length}</span></div>
      ${verifications.length ? verifications.map((verification) => `<details class="evidence-block"><summary>${esc(verification.verifier)} · ${esc(verification.result)} · ${esc(verification.independence)}</summary><div style="padding:10px"><dl class="kv"><dt>${esc(t('evidence.expected'))}</dt><dd>${esc(verification.expectedOutput)}</dd><dt>${esc(t('evidence.actual'))}</dt><dd>${esc(JSON.stringify(verification.actualOutput))}</dd><dt>${esc(t('common.tasks'))}</dt><dd class="mono">${esc(verification.taskId)}</dd></dl></div></details>`).join('') : `<p class="muted small">${esc(t('evidence.noVerification'))}</p>`}
    </div>`;
  };

  const renderMarkdown = (markdown) => {
    const lines = String(markdown || '').split('\n');
    let html = '';
    let inCode = false;
    let inList = false;
    const inline = (text) => esc(text).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    const closeList = () => { if (inList) { html += '</ul>'; inList = false; } };
    for (const line of lines) {
      if (line.trim().startsWith('```')) { if (inCode) { html += '</code></pre>'; inCode = false; } else { closeList(); html += '<pre><code>'; inCode = true; } continue; }
      if (inCode) { html += `${esc(line)}\n`; continue; }
      if (!line.trim()) { closeList(); continue; }
      const heading = line.match(/^(#{1,3})\s+(.*)$/);
      if (heading) { closeList(); html += `<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`; continue; }
      const list = line.match(/^\s*[-*]\s+(.*)$/);
      if (list) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${inline(list[1])}</li>`; continue; }
      const ordered = line.match(/^\s*\d+\.\s+(.*)$/);
      if (ordered) { closeList(); html += `<p>${inline(line.trim())}</p>`; continue; }
      closeList();
      html += `<p>${inline(line)}</p>`;
    }
    closeList();
    if (inCode) html += '</code></pre>';
    return html;
  };

  const renderArtifact = () => {
    const artifact = D.artifact;
    if (!artifact) return `<div class="tab-body"><div class="empty">${icon('file', 22, 'empty-icon')}<h3>${esc(t('artifact.noArtifact'))}</h3><p>${esc(t('artifact.noArtifactBody'))}</p></div></div>`;
    return `<div class="tab-body">
      <div class="artifact-head">
        <span class="artifact-icon" aria-hidden="true"></span>
        <div><div class="eyebrow">${esc(t('artifact.title'))}</div><h2 class="artifact-title" dir="auto">${esc(artifact.name)}</h2><div class="artifact-meta"><span>${esc(artifact.kind)}</span><span class="mono ltr">${esc(artifact.id)}</span><span>${esc(date(artifact.createdAt, state.locale))}</span></div></div>
        <div class="artifact-actions"><button class="btn btn-small" type="button" data-action="artifact-raw">${icon('terminal', 12)} ${esc(state.artifactRaw ? t('artifact.rendered') : t('artifact.raw'))}</button><button class="btn btn-small" type="button" data-action="download-artifact">${icon('file', 12)} ${esc(t('artifact.download'))}</button></div>
      </div>
      ${state.artifactRaw ? `<pre class="markdown" style="background:var(--terminal);color:var(--terminal-ink);padding:16px;direction:ltr;text-align:left;white-space:pre-wrap;max-width:none">${esc(artifact.content)}</pre>` : `<article class="markdown" dir="auto">${renderMarkdown(artifact.content)}</article>`}
      <div class="notice brand">${esc(t('artifact.sourceNote'))}</div>
    </div>`;
  };

  const renderContext = () => {
    const profile = M?.problemProfile;
    const reasoning = M?.reasoning;
    const snapshots = M?.capabilitySnapshots || [];
    return `<div class="tab-body">
      <div class="section-head"><h2>${esc(t('context.title'))}</h2><span class="aside">${esc(t('context.hint'))}</span></div>
      <div class="two-col">
        <section>
          <div class="inspector-label">${esc(t('context.problem'))}</div>
          <dl class="kv">
            <dt>${esc(t('context.domain'))}</dt><dd>${esc(profile?.domain || t('run.unknown'))}</dd>
            <dt>${esc(t('context.confidence'))}</dt><dd>${profile ? Math.round((profile.confidence || 0) * 100) + '%' : t('run.unknown')}</dd>
            <dt>${esc(t('context.sufficient'))}</dt><dd>${reasoning ? (reasoning.sufficientToProceed ? t('evidence.passed') : t('evidence.failed')) : t('run.unknown')}</dd>
            <dt>${esc(t('context.unknowns'))}</dt><dd>${esc((reasoning?.unknowns || profile?.missingInformation || []).join(' · ') || t('common.none'))}</dd>
            <dt>${esc(t('context.limitations'))}</dt><dd>${esc((reasoning?.limitations || []).join(' · ') || t('common.none'))}</dd>
          </dl>
          <div class="notice" style="margin-block-start:16px">${esc(t('plan.dependenciesHint'))}</div>
        </section>
        <section>
          <div class="inspector-label">${esc(t('context.capabilities'))}</div>
          ${snapshots.length ? snapshots.map((snap) => `<div class="evidence-block" style="margin-block-start:0;margin-block-end:8px"><div style="padding:9px 10px"><div class="row gap-8"><strong class="small">${esc(snap.profile.agentName)}</strong>${badge(snap.profile.specialization, 'neutral')}</div><div class="chips" style="margin-block-start:6px">${(snap.profile.tools || []).map((tool) => `<span class="chip">${esc(tool)}</span>`).join('') || `<span class="chip">${esc(t('common.none'))}</span>`}</div><div class="micro faint" style="margin-block-start:6px">${esc(t('context.resolved'))} ${esc(date(snap.createdAt, state.locale))} · <span class="mono ltr">${esc(snap.digest.slice(0, 12))}…</span></div></div></div>`).join('') : `<p class="muted small">${esc(t('context.noSnapshot'))}</p>`}
          <div class="notice brand" style="margin-block-start:14px">${esc(t('common.noSecret'))}</div>
        </section>
      </div>
    </div>`;
  };

  const renderRun = () => {
    if (!M) return `${renderRunHeader()}<div class="tab-body"><div class="empty">${icon('play', 22, 'empty-icon')}<h3>${esc(t('zone.noMission'))}</h3><p>${esc(t('brief.noMissionBody'))}</p><div class="actions"><button class="btn btn-primary" data-action="go" data-zone="brief">${esc(t('zone.brief'))} ${icon('arrowRight', 12)}</button></div></div></div>`;
    const content = state.tab === 'activity' ? renderActivity() : state.tab === 'evidence' ? renderEvidence() : state.tab === 'artifact' ? renderArtifact() : state.tab === 'context' ? renderContext() : renderPlan();
    return `<div class="page">${renderRunHeader()}${renderRunTabs()}${content}</div>`;
  };


  const renderLibrary = () => {
    const tabs = [['artifacts', 'library.artifacts'], ['memory', 'library.memory'], ['knowledge', 'library.knowledge']];
    const artifacts = M?.artifacts || [];
    const memories = D.memory || [];
    return `<div class="page page-wide">
      <header class="brief-head"><div class="brief-head-copy"><p class="eyebrow">WORA / ${esc(t('zone.library'))}</p><h1 class="page-title">${esc(t('library.title'))}</h1><p class="page-deck">${esc(t('library.deck'))}</p></div></header>
      <nav class="tabs library-tabs" role="tablist">${tabs.map(([id, key]) => `<button class="tab" role="tab" type="button" data-action="library-tab" data-tab="${id}" aria-selected="${state.libraryTab === id}">${esc(t(key))}${id === 'artifacts' ? `<span class="tab-count">${artifacts.length}</span>` : id === 'memory' ? `<span class="tab-count">${memories.length}</span>` : ''}</button>`).join('')}</nav>
      ${state.libraryTab === 'artifacts' ? `<div class="tab-body">
        <div class="section-head"><h2>${esc(t('library.deliverables'))}</h2><span class="aside">${esc(t('artifact.sourceNote'))}</span></div>
        ${artifacts.length > 1 ? `<div class="artifact-list">${artifacts.map((artifact) => `<button class="artifact-row is-selected" type="button" data-action="open-artifact" data-id="${esc(artifact.id)}"><span>${icon('file', 18, 'muted')}</span><span><span class="artifact-list-name">${esc(artifact.name)}</span><span class="artifact-list-meta"><span>${esc(artifact.kind)}</span><span class="mono ltr">${esc(artifact.id)}</span><span>${esc(shortDate(M.updatedAt, state.locale))}</span></span></span>${badge(M.artifact?.kind || t('common.available'), 'brand')}</button>`).join('')}</div>` : artifacts.length === 0 ? `<div class="empty">${icon('file', 22, 'empty-icon')}<h3>${esc(t('artifact.noArtifact'))}</h3><p>${esc(t('artifact.noArtifactBody'))}</p></div>` : ''}
        ${D.artifact ? `<div class="artifact-head" style="margin-block-start:18px"><span class="artifact-icon" aria-hidden="true"></span><div><div class="eyebrow">${esc(t('artifact.title'))}</div><h2 class="artifact-title">${esc(D.artifact.name)}</h2><div class="artifact-meta"><span>${esc(D.artifact.kind)}</span><span class="mono ltr">${esc(D.artifact.id)}</span><span>${esc(date(D.artifact.createdAt, state.locale))}</span></div></div><div class="artifact-actions"><button class="btn btn-small" data-action="open-artifact" data-id="${esc(D.artifact.id)}">${icon('eye', 12)} ${esc(t('artifact.open'))}</button></div></div><article class="markdown" dir="auto">${renderMarkdown(D.artifact.content)}</article>` : ''}
      </div>` : state.libraryTab === 'memory' ? `<div class="tab-body">
        <div class="section-head"><h2>${esc(t('library.memory'))}</h2><span class="aside">${esc(t('library.memoryCount', { n: memories.length }))}</span></div>
        <div class="memory-list">${memories.map((memory) => `<div class="memory-row"><span>${icon('database', 16, 'muted')}</span><span><span class="memory-content" dir="auto">${esc(memory.content)}</span><span class="memory-meta">${esc(t('library.memorySource'))} · <span class="mono ltr">${esc(memory.id)}</span> · ${esc(date(memory.createdAt, state.locale))}</span></span>${badge('memory', 'neutral')}</div>`).join('')}</div>
        <div class="notice brand" style="margin-block-start:18px">${esc(t('common.noSecret'))}</div>
      </div>` : `<div class="tab-body"><div class="empty">${icon('library', 22, 'empty-icon')}<h3>${esc(t('library.noKnowledge'))}</h3><p>${esc(t('library.noKnowledgeBody'))}</p><div class="actions"><button class="btn" data-action="go" data-zone="capabilities">${esc(t('zone.capabilities'))} ${icon('arrowRight', 12)}</button></div></div></div>`}
    </div>`;
  };

  const filteredPackages = () => {
    const query = state.filter.trim().toLowerCase();
    return (D.packages || []).filter((pkg) => {
      if (state.capTab === 'skills' && pkg.kind !== 'skill') return false;
      if (state.capTab === 'plugins' && pkg.kind !== 'plugin') return false;
      if (!query) return true;
      return [pkg.name, pkg.key, pkg.category, pkg.description, pkg.author].join(' ').toLowerCase().includes(query);
    });
  };

  const trustBadge = (trust) => {
    const keys = { official: 'cap.trustOfficial', verified: 'cap.trustVerified', community: 'cap.trustCommunity', untrusted: 'cap.trustUntrusted' };
    return badge(t(keys[trust] || 'common.notExposed'), toneFor(trust));
  };
  const packageState = (pkg) => pkg.installed ? (pkg.enabled ? badge(t('common.enabled'), 'success') : badge(t('common.disabled'), 'signal')) : badge(t('common.notInstalled'), 'neutral');

  const renderAgents = () => {
    const agents = D.agents.filter((agent) => !state.filter.trim() || [agent.name, agent.specialization, agent.role].join(' ').toLowerCase().includes(state.filter.trim().toLowerCase()));
    return `<div class="agent-list">${agents.map((agent) => `<button class="agent-row ${state.selectedAgentId === agent.id ? 'is-selected' : ''}" type="button" data-action="select-agent" data-id="${esc(agent.id)}"><span class="agent-avatar">${esc(agent.name.split(' ').map((part) => part[0]).slice(0, 2).join(''))}</span><span><span class="agent-name" dir="auto">${esc(agent.name)}</span><span class="agent-spec"><span>${esc(agent.specialization)}</span><span>·</span><span>${esc(agent.role)}</span></span></span><span class="agent-stat"><b>${agent.tools.length}</b>${esc(t('common.tools'))}</span><span>${onMission(agent.id) ? badge(t('missionSwitcher.current'), 'brand') : statusBadge(agent.status)}</span></button>`).join('')}</div>`;
  };

  const renderPackages = () => {
    const packages = filteredPackages();
    if (!packages.length) return `<div class="empty">${icon('package', 22, 'empty-icon')}<h3>${esc(t('common.empty'))}</h3><p>${esc(t('common.search'))}</p></div>`;
    return `<div class="package-list">${packages.map((pkg) => `<button class="package-row ${state.selectedPackageId === pkg.id ? 'is-selected' : ''}" type="button" data-action="select-package" data-id="${esc(pkg.id)}"><span class="package-kind">${icon(pkg.kind === 'skill' ? 'layers' : 'plug', 12)}</span><span><span class="package-name" dir="auto">${esc(pkg.name)}</span><span class="package-meta"><span class="mono ltr">${esc(pkg.key)}</span><span>·</span><span>${esc(pkg.latestVersion)}</span><span>·</span><span>${esc(pkg.category)}</span></span></span><span>${trustBadge(pkg.trust)}</span><span class="package-state">${packageState(pkg)}</span></button>`).join('')}</div>`;
  };

  const renderCapabilities = () => {
    const tabs = [['agents', 'cap.agentsTab', D.agents.length], ['skills', 'cap.skillsTab', D.packages.filter((p) => p.kind === 'skill').length], ['plugins', 'cap.pluginsTab', D.packages.filter((p) => p.kind === 'plugin').length], ['mcp', 'cap.mcpTab', D.mcp.length]];
    const marketplace = D.marketplaces?.[0];
    const list = state.capTab === 'agents' ? renderAgents() : state.capTab === 'skills' || state.capTab === 'plugins' ? renderPackages() : '';
    const empty = state.capTab === 'plugins' ? `<div class="empty">${icon('plug', 22, 'empty-icon')}<h3>${esc(t('cap.noPlugins'))}</h3><p>${esc(t('cap.noPluginsBody'))}</p></div>` : state.capTab === 'mcp' ? `<div class="empty">${icon('plug', 22, 'empty-icon')}<h3>${esc(t('cap.noMcp'))}</h3><p>${esc(t('cap.noMcpBody'))}</p></div>` : '';
    return `<div class="page page-wide">
      <header class="brief-head"><div class="brief-head-copy"><p class="eyebrow">WORA / ${esc(t('zone.capabilities'))}</p><h1 class="page-title">${esc(t('cap.title'))}</h1><p class="page-deck">${esc(t('cap.deck'))}</p></div></header>
      <div class="cap-summary"><div><b>${num(D.agents.length)}</b><span>${esc(t('cap.agentCount'))}</span></div><div><b>${num(D.packages.length)}</b><span>${esc(t('common.packages'))}</span></div><div><b>${num(D.state.installed || 0)}</b><span>${esc(t('cap.installedCount'))}</span></div><div><b>${num(D.mcp.length)}</b><span>${esc(t('cap.mcpCount'))}</span></div></div>
      <nav class="tabs library-tabs" role="tablist">${tabs.map(([id, key, count]) => `<button class="tab" role="tab" type="button" data-action="cap-tab" data-tab="${id}" aria-selected="${state.capTab === id}">${esc(t(key))}<span class="tab-count">${count}</span></button>`).join('')}</nav>
      ${state.capTab === 'agents' || state.capTab === 'skills' || state.capTab === 'plugins' ? `<div class="cap-toolbar"><div class="search-field">${icon('search', 14)}<input id="cap-search" value="${esc(state.filter)}" placeholder="${esc(t('common.search'))}" aria-label="${esc(t('common.search'))}" /></div>${badge(state.capTab === 'agents' ? `${num(D.agents.length)} ${t('common.agents')}` : `${num(filteredPackages().length)} ${t('common.packages')}`, 'neutral')}</div>` : ''}
      ${state.capTab === 'mcp' ? empty : state.capTab === 'plugins' && filteredPackages().length === 0 ? empty : list}
      ${marketplace && state.capTab !== 'agents' && state.capTab !== 'mcp' ? `<div class="notice brand" style="margin-block-start:18px"><strong>${esc(t('cap.marketplace'))}:</strong> ${esc(t('cap.marketplaceLine', { n: marketplace.packageCount, status: marketStatusText(marketplace.status) }))} · <span class="mono ltr">${esc(marketplace.url)}</span></div>` : ''}
      <div class="catalog-legend"><span><i class="dot-key available"></i>${esc(t('common.available'))}</span><span><i class="dot-key installed"></i>${esc(t('common.installed'))}</span><span>${esc(t('common.notExposed'))}</span></div>
    </div>`;
  };



  const modeText = (mode) => mode === 'opt-in-worker' ? t('runtime.optInWorker') : (mode || '—');
  const workerText = (mode) => mode === 'supported-with-sqlite-serialization' ? t('runtime.sqliteWorkers') : (mode || '—');

  const marketStatusText = (status) => {
    const key = 'marketStatus.' + status;
    return t(key) === key ? status : t(key);
  };

  const yesNo = (value) => value ? t('common.yes') : t('common.no');
  const enabledText = (value) => value ? t('common.enabled') : t('common.disabled');

  const renderSystem = () => {
    const rt = D.runtime || {};
    const tabs = [['runtime', 'system.runtime'], ['approvals', 'system.approvals'], ['usage', 'system.usage']];
    const approvals = M?.approvals || [];
    return `<div class="page page-wide">
      <header class="brief-head"><div class="brief-head-copy"><p class="eyebrow">WORA / ${esc(t('zone.system'))}</p><h1 class="page-title">${esc(t('system.title'))}</h1><p class="page-deck">${esc(t('system.deck'))}</p></div></header>
      <nav class="tabs library-tabs" role="tablist">${tabs.map(([id, key]) => `<button class="tab" role="tab" type="button" data-action="system-tab" data-tab="${id}" aria-selected="${state.systemTab === id}">${esc(t(key))}${id === 'approvals' ? `<span class="tab-count">${approvals.filter((a) => a.status === 'pending').length}</span>` : ''}</button>`).join('')}</nav>
      ${state.systemTab === 'runtime' ? `<div class="system-grid"><section><div class="inspector-label">${esc(t('system.runtime'))}</div><dl class="runtime-facts"><div class="fact"><dt>${esc(t('system.mode'))}</dt><dd class="good">${esc(modeText(rt.mode))}</dd></div><div class="fact"><dt>${esc(t('system.durableStore'))}</dt><dd class="${rt.durableStore ? 'good' : 'warn'}">${yesNo(rt.durableStore)}</dd></div><div class="fact"><dt>${esc(t('system.missionLease'))}</dt><dd>${enabledText(rt.missionLease)}</dd></div><div class="fact"><dt>${esc(t('system.taskLeases'))}</dt><dd>${enabledText(rt.taskLeases)}</dd></div><div class="fact"><dt>${esc(t('system.checkpoints'))}</dt><dd>${enabledText(rt.checkpoints)}</dd></div><div class="fact"><dt>${esc(t('system.independentWorkers'))}</dt><dd>${esc(workerText(rt.independentWorkers))}</dd></div><div class="fact"><dt>${esc(t('system.maxTasks'))}</dt><dd class="mono">${num(rt.limits?.maxConcurrentTasks || 0)}</dd></div><div class="fact"><dt>${esc(t('system.leaseTtl'))}</dt><dd class="mono">${Math.round((rt.limits?.leaseTtlMs || 0) / 1000)}${t('common.secondsShort')}</dd></div><div class="fact"><dt>${esc(t('system.maxAttempts'))}</dt><dd class="mono">${num(rt.limits?.maxAttempts || 0)}</dd></div><div class="fact"><dt>${esc(t('system.recovery'))}</dt><dd>${rt.recovery?.resumable ? t('common.resumable') : t('common.notResumable')}</dd></div><div class="fact"><dt>${esc(t('system.blockedTasks'))}</dt><dd class="warn">${num(rt.recovery?.blockedTasks || 0)}</dd></div><div class="fact"><dt>${esc(t('system.pendingApprovals'))}</dt><dd class="warn">${num(rt.recovery?.pendingApprovals || 0)}</dd></div><div class="fact"><dt>${esc(t('system.activeLeases'))}</dt><dd>${num(rt.activeLeases || 0)}</dd></div></dl></section>
        <aside class="system-aside"><div class="inspector-label">${esc(t('system.limitations'))}</div><div class="limitations">${(rt.limitations || []).map((limitation) => `<div class="limitation">${esc(limitationText(limitation))}</div>`).join('')}</div><div class="notice" style="margin-block-start:18px">${esc(t('system.noQueue'))}</div><div class="notice brand" style="margin-block-start:12px">${esc(t('system.noDenialsBody'))}</div></aside></div>` : state.systemTab === 'approvals' ? `<div class="tab-body"><div class="section-head"><h2>${esc(t('system.approvals'))}</h2><span class="aside">${esc(t('approval.pendingCount', { n: approvals.filter((a) => a.status === 'pending').length }))}</span></div><div class="approval-list">${approvals.length ? approvals.map((approval) => `<button class="approval-row" type="button" data-action="open-approval"><div class="approval-row-head">${riskBadge(approval.risk)}${statusBadge(approval.status)}<span class="mono faint">${esc(approval.toolId || approval.kind)}</span></div><div class="approval-row-title" style="margin-block-start:6px">${esc(clamp(approval.actionSummary, 150))}</div><div class="approval-row-copy">${esc(approval.consequences || approval.target || '')}</div></button>`).join('') : `<div class="empty"><h3>${esc(t('approval.noPending'))}</h3></div>`}</div></div>` : `<div class="tab-body"><div class="section-head"><h2>${esc(t('system.usage'))}</h2><span class="aside">${esc(t('common.notBilling'))}</span></div><div class="usage-big">${num(D.usage?.totals?.calls || 0)}</div><p class="muted small">${esc(t('system.noCalls'))}</p><div class="notice" style="margin-block-start:18px">${esc(state.locale === 'ar' ? t('system.pricingNote') : (D.usage?.pricingNote || t('system.usageNote')))}</div><div class="notice" style="margin-block-start:12px">${esc(t('system.noDenialsBody'))}</div></div>`}
    </div>`;
  };

  const kv = (rows) => `<dl class="kv">${rows.filter(Boolean).map(([key, value, mono]) => `<dt>${esc(key)}</dt><dd class="${mono ? 'mono ltr' : ''}">${value}</dd>`).join('')}</dl>`;
  const rawDetails = (label, value) => `<details class="evidence-block raw-json"><summary>${esc(label)}</summary><pre>${esc(JSON.stringify(value, null, 2).slice(0, 6000))}</pre></details>`;

  const renderTaskInspector = (task) => {
    const snapshot = snapshotFor(task.id);
    const runs = task.runs || [];
    const pending = pendingApproval();
    const header = `<div class="inspector-head"><div class="inspector-eyebrow">${icon('bot', 12)} <span>${esc(t('inspector.title'))}</span><span>·</span><span class="mono">${esc(task.id.slice(0, 14))}…</span></div><div class="inspector-title" dir="auto">${esc(task.title)}</div><div class="inspector-sub">${taskBadge(task.status)} <span>${esc(task.specialization)}</span></div></div>`;
    return `${header}<div class="inspector-body">
      <section class="inspector-section"><div class="inspector-label">${esc(t('inspector.identity'))}</div>${kv([[t('common.agent'), esc(task.agent?.name || t('common.none'))], [t('common.specialization'), esc(task.specialization)], [t('common.tool'), `<span class="mono">${esc(task.tool || t('common.none'))}</span>`], [t('common.status'), taskBadge(task.status)], [t('common.depends'), task.dependsOn?.length ? task.dependsOn.map((id) => `<span class="mono">${esc(id.slice(0, 12))}…</span>`).join(' ') : esc(t('common.noDependencies'))]])}</section>
      <section class="inspector-section"><div class="inspector-label">${esc(t('inspector.why'))}</div><p class="small muted" dir="auto">${esc(task.detail || task.objective)}</p>${task.status === 'blocked' && pending ? `<div class="notice" style="margin-block-start:10px">${esc(t('approval.taskBlocked'))}: ${esc(pending.actionSummary)}</div><button class="btn btn-small btn-primary" type="button" data-action="open-approval" style="margin-block-start:10px">${esc(t('run.reviewApproval'))}</button>` : ''}</section>
      <section class="inspector-section"><div class="inspector-label">${esc(t('plan.acceptance'))}</div><ul class="checks">${(task.acceptance || []).map((item) => `<li class="check"><span class="check-icon pass">${icon('check', 11)}</span><span>${esc(item)}</span></li>`).join('') || `<li class="muted small">${esc(t('common.none'))}</li>`}</ul></section>
      <section class="inspector-section"><div class="inspector-label">${esc(t('inspector.evidence'))}</div>${runs.length ? runs.map((run) => `<div class="evidence-block" style="margin-block-start:0;margin-block-end:8px"><div style="padding:9px 10px"><div class="row gap-8"><strong class="small">${esc(t('inspector.runEvidence', { n: run.attempt }))}</strong>${badge(run.status, toneFor(run.status))}<span class="micro faint mono">${esc(run.id)}</span></div><div class="micro muted" style="margin-block-start:4px">${esc(run.summary)}</div>${(run.evidence || []).map((evidence, index) => `<details class="evidence-block"><summary>${esc(evidence.tool)} · ${evidence.ok ? t('evidence.passed') : t('evidence.failed')} · ${num(evidence.durationMs || 0)}ms</summary><pre>${esc(JSON.stringify({ output: evidence.output, independentChecks: evidence.independentChecks, digest: evidence.artifactDigest }, null, 2).slice(0, 4200))}</pre></details>`).join('')}</div></div>`).join('') : `<p class="muted small">${esc(t('inspector.noRuns'))}</p>`}</section>
      <section class="inspector-section"><div class="inspector-label">${esc(t('inspector.authority'))}</div>${snapshot ? `${kv([[t('inspector.tools'), (snapshot.profile.tools || []).map((tool) => `<span class="chip">${esc(tool)}</span>`).join(' ') || esc(t('common.none'))], [t('inspector.skills'), (snapshot.profile.skills || []).length ? esc(snapshot.profile.skills.join(', ')) : esc(t('context.noSkills'))], [t('inspector.plugins'), (snapshot.profile.plugins || []).length ? esc(snapshot.profile.plugins.join(', ')) : esc(t('context.noPlugins'))], [t('common.permissions'), (snapshot.profile.permissions || []).map((p) => `<span class="chip chip-perm">${esc(p)}</span>`).join(' ') || esc(t('common.none'))], [t('inspector.limits'), esc(JSON.stringify(snapshot.profile.limits || {}))], [t('inspector.capabilityDigest'), `<span class="mono">${esc(snapshot.digest.slice(0, 20))}…</span>`]])}<div class="micro faint" style="margin-block-start:7px">${esc(t('context.resolved'))} ${esc(date(snapshot.createdAt, state.locale))}</div>` : `<p class="muted small">${esc(t('inspector.noSnapshot'))}</p>`}<p class="micro faint" style="margin-block-start:10px">${esc(t('common.noSecret'))}</p></section>
      <section class="inspector-section"><div class="inspector-label">${esc(t('inspector.raw'))}</div>${rawDetails(t('common.showRaw'), { task, snapshot })}</section>
    </div>`;
  };

  const renderAgentInspector = (agent) => {
    const header = `<div class="inspector-head"><div class="inspector-eyebrow">${icon('bot', 12)} <span>${esc(t('cap.agentProfile'))}</span></div><div class="inspector-title">${esc(agent.name)}</div><div class="inspector-sub">${statusBadge(agent.status)} <span class="mono">${esc(agent.specialization)}</span></div></div>`;
    return `${header}<div class="inspector-body">
      <section class="inspector-section"><div class="inspector-label">${esc(t('inspector.identity'))}</div>${kv([[t('inspector.role'), esc(agent.role)], [t('common.status'), statusBadge(agent.status)], [t('inspector.model'), esc(agent.model?.model || t('common.none'))], [t('cap.currentMission'), onMission(agent.id) ? badge(t('missionSwitcher.current'), 'brand') : badge(t('cap.notInMission'), 'neutral')]])}</section>
      <section class="inspector-section"><div class="inspector-label">${esc(t('inspector.tools'))}</div><div class="chips">${(agent.tools || []).map((tool) => `<span class="chip">${esc(tool)}</span>`).join('') || `<span class="chip">${esc(t('common.none'))}</span>`}</div></section>
      <section class="inspector-section"><div class="inspector-label">${esc(t('inspector.skills'))}</div><div class="chips">${(agent.skills || []).map((skill) => `<span class="chip">${esc(skill)}</span>`).join('') || `<span class="chip">${esc(t('context.noSkills'))}</span>`}</div></section>
      <section class="inspector-section"><div class="inspector-label">${esc(t('common.permissions'))}</div><div class="chips">${(agent.permissions || []).map((permission) => `<span class="chip chip-perm">${esc(permission)}</span>`).join('') || `<span class="chip">${esc(t('common.none'))}</span>`}</div></section>
      <section class="inspector-section"><div class="inspector-label">${esc(t('inspector.limits'))}</div>${kv(Object.entries(agent.limits || {}).map(([key, value]) => [key, esc(value), true]))}</section>
      <section class="inspector-section">${rawDetails(t('common.showRaw'), agent)}</section>
    </div>`;
  };

  const scopeText = (scopes = []) => scopes.map((scope) => t('scope.' + scope) === 'scope.' + scope ? scope : t('scope.' + scope)).join(' · ');
  const typeText = (type) => {
    const key = 'pkgType.' + type;
    return t(key) === key ? type : t(key);
  };
  const execText = (mode) => {
    const key = 'execModel.' + mode;
    return t(key) === key ? mode : t(key);
  };

  const renderPackageInspector = (pkg) => {
    const header = `<div class="inspector-head"><div class="inspector-eyebrow">${icon(pkg.kind === 'skill' ? 'layers' : 'plug', 12)} <span>${esc(t('common.packages'))}</span><span>·</span><span class="mono">${esc(pkg.kind)}</span></div><div class="inspector-title">${esc(pkg.name)}</div><div class="inspector-sub">${trustBadge(pkg.trust)} <span class="mono">${esc(pkg.latestVersion)}</span> ${packageState(pkg)}</div></div>`;
    return `${header}<div class="inspector-body">
      <section class="inspector-section"><div class="inspector-label">${esc(t('cap.description'))}</div><p class="small muted" dir="auto">${esc(pkg.description)}</p><div class="chips" style="margin-block-start:8px"><span class="chip">${esc(pkg.category)}</span>${(pkg.tags || []).slice(0, 4).map((tag) => `<span class="chip">${esc(tag)}</span>`).join('')}</div></section>
      <section class="inspector-section"><div class="inspector-label">${esc(t('inspector.identity'))}</div>${kv([[t('common.author'), esc(pkg.author)], [t('common.version'), esc(pkg.latestVersion)], [t('common.type'), esc(typeText(pkg.type))], [t('common.scope'), esc(scopeText(pkg.scope))], [t('common.trust'), trustBadge(pkg.trust)], [t('inspector.executionModel'), esc(execText(pkg.executionModel))], [t('inspector.installState'), packageState(pkg)], [t('common.digest'), `<span class="mono">${esc(pkg.checksum?.slice(0, 20) || '—')}</span>`]])}</section>
      <section class="inspector-section"><div class="inspector-label">${esc(t('cap.permissions'))}</div><div class="chips">${(pkg.permissions || []).map((permission) => `<span class="chip ${permission.sensitivity === 'high' ? 'chip-risk-high' : 'chip-perm'}">${esc(permission.name)}</span>`).join('') || `<span class="chip">${esc(t('common.none'))}</span>`}</div><p class="micro faint" style="margin-block-start:8px">${esc(t('common.noSecret'))}</p></section>
      <section class="inspector-section"><div class="inspector-label">${esc(t('cap.dependencies'))}</div>${(pkg.dependencies || []).length ? (pkg.dependencies || []).map((dep) => `<div class="small mono">${esc(dep.id)} <span class="faint">${esc(dep.version)}</span></div>`).join('') : `<p class="small muted">${esc(t('common.none'))}</p>`}<div class="notice" style="margin-block-start:10px">${esc(t('cap.noInstallAction'))}</div></section>
      <section class="inspector-section">${rawDetails(t('inspector.manifest'), { key: pkg.key, versions: pkg.versions, compatibility: pkg.compatibility, security: pkg.security })}</section>
    </div>`;
  };

  const renderMemoryInspector = () => `<div class="inspector-head"><div class="inspector-eyebrow">${icon('database', 12)} <span>${esc(t('library.memory'))}</span></div><div class="inspector-title">${esc(t('library.memoryInspectorTitle'))}</div><div class="inspector-sub">${esc(t('library.memoryCount', { n: (D.memory || []).length }))}</div></div><div class="inspector-body"><section class="inspector-section"><div class="inspector-label">${esc(t('inspector.why'))}</div><p class="small muted">${esc(t('library.memoryNote'))}</p></section><section class="inspector-section"><div class="inspector-label">${esc(t('common.noSecret'))}</div><p class="small muted">${esc(t('common.notBilling'))}</p></section></div>`;

  const renderKnowledgeInspector = () => `<div class="inspector-head"><div class="inspector-eyebrow">${icon('library', 12)} <span>${esc(t('library.knowledge'))}</span></div><div class="inspector-title">${esc(t('library.noKnowledge'))}</div><div class="inspector-sub">${esc(t('library.knowledgeNote'))}</div></div><div class="inspector-body"><section class="inspector-section"><div class="inspector-label">${esc(t('cap.registry'))}</div><p class="small muted">${esc(t('library.knowledgeBody'))}</p><button class="btn btn-small" type="button" data-action="go" data-zone="capabilities" style="margin-block-start:10px">${esc(t('zone.capabilities'))} ${icon('arrowRight', 12)}</button></section></div>`;

  const renderArtifactInspector = () => {
    const artifact = D.artifact;
    if (!artifact) return `<div class="inspector-head"><div class="inspector-title">${esc(t('inspector.title'))}</div></div><div class="inspector-body"><p class="muted small">${esc(t('artifact.noArtifact'))}</p></div>`;
    return `<div class="inspector-head"><div class="inspector-eyebrow">${icon('file', 12)} <span>${esc(t('artifact.title'))}</span></div><div class="inspector-title">${esc(artifact.name)}</div><div class="inspector-sub">${badge(artifact.kind, 'brand')}</div></div><div class="inspector-body"><section class="inspector-section"><div class="inspector-label">${esc(t('inspector.identity'))}</div>${kv([[t('common.status'), badge(t('common.available'), 'success')], [t('common.digest'), `<span class="mono">${esc(artifact.id)}</span>`], [t('common.created'), esc(date(artifact.createdAt, state.locale))], [t('zone.run'), `<button class="inline-link" data-action="go" data-zone="run">${esc(t('artifact.open'))}</button>`]])}</section><section class="inspector-section"><div class="inspector-label">${esc(t('cap.description'))}</div><p class="small muted">${esc(t('artifact.sourceNote'))}</p></section></div>`;
  };

  const renderApprovalInspector = (approval) => `<div class="inspector-head"><div class="inspector-eyebrow">${icon('shield', 12)} <span>${esc(t('approval.title'))}</span></div><div class="inspector-title">${esc(clamp(approval.actionSummary, 90))}</div><div class="inspector-sub">${riskBadge(approval.risk)} ${statusBadge(approval.status)}</div></div><div class="inspector-body"><section class="inspector-section"><div class="inspector-label">${esc(t('common.status'))}</div>${kv([[t('common.tool'), `<span class="mono">${esc(approval.toolId || approval.kind)}</span>`], [t('approval.requestedBy'), esc(approval.requestedBy)], [t('common.updated'), esc(date(approval.createdAt, state.locale))]])}</section><section class="inspector-section"><div class="inspector-label">${esc(t('approval.exactPayload'))}</div><pre style="background:var(--terminal);color:var(--terminal-ink);padding:10px;direction:ltr;text-align:left;font-family:var(--mono);font-size:9.5px;overflow:auto">${esc(JSON.stringify(approval.toolInput, null, 2))}</pre></section><button class="btn btn-primary" data-action="open-approval" style="width:100%">${esc(t('run.reviewApproval'))}</button></div>`;

  Object.assign(STR, {
    'brief.title': { ar: 'ما النتيجة التي تريدها؟', en: 'What outcome do you want?' },
    'brief.deck': { ar: 'اكتب هدفاً واحداً واضحاً. ستحلله WORA، وتخططه، وتسنده إلى متخصصين، ثم تنفذه وتتحقق منه قبل التسليم.', en: 'State one clear outcome. WORA will understand it, plan it, assign specialists, execute, and independently verify before delivery.' },
    'brief.composerTitle': { ar: 'نية جديدة', en: 'New intent' },
    'brief.composerHint': { ar: 'السياق المرفق يحدد ما تستطيع WORA استخدامه — وليس كل ما هو مثبّت.', en: 'Attached context determines what WORA may use — not everything that is installed.' },
    'brief.placeholder': { ar: 'مثال: ابنِ تطبيق ويب جاهزاً للإنتاج وتحقق منه باختبارات...', en: 'Example: build a production-ready web app and verify it with tests…' },
    'brief.context': { ar: 'السياق', en: 'Context' },
    'brief.submit': { ar: 'مراجعة النية', en: 'Review intent' },
    'brief.preview': { ar: 'معاينة فقط', en: 'Preview only' },
    'brief.examples': { ar: 'أهداف مقترحة', en: 'Suggested outcomes' },
    'brief.recent': { ar: 'مهام حديثة', en: 'Recent missions' },
    'brief.how': { ar: 'كيف تعمل WORA', en: 'How WORA works' },
    'brief.readiness': { ar: 'جاهزية التشغيل', en: 'Operating readiness' },
    'brief.agents': { ar: 'وكيل متخصص', en: 'specialist agents' },
    'brief.tools': { ar: 'أداة أساسية', en: 'core tools' },
    'brief.packages': { ar: 'حزمة متاحة', en: 'available packages' },
    'brief.installed': { ar: 'مثبّتة', en: 'installed' },
    'brief.noMission': { ar: 'لا توجد مهمة نشطة', en: 'No active mission' },
    'brief.noMissionBody': { ar: 'ابدأ بنية جديدة أعلاه. ستظهر هنا حالة المهمة عندما تبدأ.', en: 'Compose a new intent above. Mission state will appear here once it starts.' },
    'brief.recentEmpty': { ar: 'لا توجد مهام سابقة بعد.', en: 'No previous missions yet.' },
    'brief.how1': { ar: 'يفهم الهدف والقيود', en: 'Understands the outcome and constraints' },
    'brief.how1Copy': { ar: 'يبني نموذج المشكلة ويحدد ما ينقصه قبل التنفيذ.', en: 'Builds a problem model and names what is missing before execution.' },
    'brief.how2': { ar: 'يخطط ويسند', en: 'Plans and assigns' },
    'brief.how2Copy': { ar: 'يختار استراتيجية، ويكوّن مهام مرتبطة، ويسندها إلى متخصصين.', en: 'Selects a strategy, composes dependent tasks, and assigns specialists.' },
    'brief.how3': { ar: 'ينفذ ويتحقق', en: 'Executes and verifies' },
    'brief.how3Copy': { ar: 'يجمع الأدلة، ويفحص النتائج باستقلال، ويطلب تدخلك عند الحاجة.', en: 'Collects evidence, independently checks results, and asks for intervention when needed.' },
    'brief.how4': { ar: 'يسلّم', en: 'Delivers' },
    'brief.how4Copy': { ar: 'ينتج مخرجاً قابلاً للفحص ويربطه بالمهمة والأدلة.', en: 'Produces an inspectable artifact linked to the mission and evidence.' },
    'brief.honest': { ar: 'الحزم المثبتة حالياً 0. المهمة الحالية استخدمت أدوات أساسية وثلاث لقطات قدرات. لا تدّعي الواجهة أن مهارة أو إضافة شاركت في التنفيذ.', en: 'Installed packages: 0. The current mission used core tools and three capability snapshots. The UI does not claim that a skill or plugin participated.' },
    'library.title': { ar: 'ما أنتجته WORA', en: 'What WORA produced' },
    'library.deck': { ar: 'المخرجات والذاكرة والمعرفة — قابلة للفحص، ومرتبطة بأصلها.', en: 'Artifacts, memory, and knowledge — inspectable and linked to their source.' },
    'library.artifacts': { ar: 'المخرجات', en: 'Artifacts' },
    'library.memory': { ar: 'الذاكرة', en: 'Memory' },
    'library.knowledge': { ar: 'المعرفة', en: 'Knowledge' },
    'library.artifactCount': { ar: '{n} مخرج', en: '{n} artifact' },
    'library.memoryCount': { ar: '{n} سجل ذاكرة', en: '{n} memory records' },
    'library.noKnowledge': { ar: 'سطح المعرفة غير متاح', en: 'Knowledge surface not exposed' },
    'library.noKnowledgeBody': { ar: 'لا توجد واجهة برمجية مخصصة لقائمة المعرفة في هذا الإصدار. لن نعرض مكتبة وهمية.', en: 'This version has no dedicated knowledge-list API. We will not render a fake library.' },
    'library.memorySource': { ar: 'من إكمال مهمة', en: 'From task completion' },
    'library.deliverables': { ar: 'التسليمات', en: 'Deliverables' },
    'cap.title': { ar: 'القدرات تُسند، لا تُفترض', en: 'Capabilities are assigned, not ambient' },
    'cap.deck': { ar: 'الوكلاء والأدوات والمهارات والإضافات وخوادم MCP — كلها تحت صلاحيات صريحة، وكل مهمة تسجل ما استخدمته فعلاً.', en: 'Agents, tools, skills, plugins, and MCP servers — all under explicit permissions, with every mission recording what it actually used.' },
    'cap.agentsTab': { ar: 'الوكلاء', en: 'Agents' },
    'cap.skillsTab': { ar: 'المهارات', en: 'Skills' },
    'cap.pluginsTab': { ar: 'الإضافات', en: 'Plugins' },
    'cap.mcpTab': { ar: 'MCP', en: 'MCP' },
    'cap.agentCount': { ar: 'وكيل', en: 'agents' },
    'cap.skillCount': { ar: 'مهارة', en: 'skills' },
    'cap.pluginCount': { ar: 'إضافة', en: 'plugins' },
    'cap.installedCount': { ar: 'مثبّت', en: 'installed' },
    'cap.mcpCount': { ar: 'خادم MCP', en: 'MCP servers' },
    'cap.noPlugins': { ar: 'لا توجد إضافات مثبتة', en: 'No plugins installed' },
    'cap.noPluginsBody': { ar: 'الإضافة الوحيدة في الكتالوج غير مثبتة؛ لذلك لا توجد أدوات إضافات مسجلة.', en: 'The only catalog plugin is not installed, so no plugin tools are registered.' },
    'cap.noMcp': { ar: 'لا توجد اتصالات MCP', en: 'No MCP connections' },
    'cap.noMcpBody': { ar: 'الأدوات الأساسية متاحة. لا يوجد خادم MCP خارجي مرتبط أو مفعّل.', en: 'Core tools are available. No external MCP server is connected or enabled.' },
    'cap.marketplace': { ar: 'السوق', en: 'Marketplace' },
    'cap.marketplaceLine': { ar: 'WORA الرسمي · مدمج · {n} حزمة · الحالة {status}', en: 'WORA Official · built-in · {n} packages · {status}' },
    'cap.registry': { ar: 'سجل القدرات', en: 'Capability registry' },
    'cap.selectPackageTitle': { ar: 'افتح حزمة لفحصها', en: 'Open a package to inspect it' },
    'cap.selectPackageBody': { ar: 'اختر مهارة أو إضافة لعرض البيان والصلاحيات والمصدر دون مغادرة الملف.', en: 'Select a skill or plugin to inspect its manifest, permissions, and source without leaving the catalog.' },
    'cap.permissions': { ar: 'الصلاحيات المطلوبة', en: 'Required permissions' },
    'cap.trustOfficial': { ar: 'رسمي', en: 'Official' },
    'cap.trustVerified': { ar: 'موثّق', en: 'Verified' },
    'cap.trustCommunity': { ar: 'مجتمعي', en: 'Community' },
    'cap.trustUntrusted': { ar: 'غير موثوق', en: 'Untrusted' },
    'cap.description': { ar: 'الوصف', en: 'Description' },
    'cap.dependencies': { ar: 'التبعيات', en: 'Dependencies' },
    'cap.noInstallAction': { ar: 'التثبيت غير مفعّل في هذا النموذج المسجّل. في الإنتاج يبدأ بمعاينة خطة التثبيت.', en: 'Installation is not enabled in this recorded prototype. Production starts with an install-plan preview.' },
    'cap.agentProfile': { ar: 'ملف الوكيل', en: 'Agent profile' },
    'cap.currentMission': { ar: 'شارك في المهمة الحالية', en: 'Involved in current mission' },
    'cap.notInMission': { ar: 'غير مشارك في المهمة الحالية', en: 'Not involved in current mission' },
    'system.title': { ar: 'النظام تحت السطح', en: 'The system underneath' },
    'system.deck': { ar: 'التشغيل الدائم، الحوكمة، والفوترة — بشفافية، بما في ذلك ما لا يعمل بعد.', en: 'Durable execution, governance, and usage — with the limitations stated plainly.' },
    'system.runtime': { ar: 'زمن التشغيل', en: 'Runtime' },
    'system.approvals': { ar: 'الموافقات', en: 'Approvals' },
    'system.usage': { ar: 'الاستخدام', en: 'Usage' },
    'system.mode': { ar: 'الوضع', en: 'Mode' },
    'system.durableStore': { ar: 'مخزن دائم', en: 'Durable store' },
    'system.missionLease': { ar: 'قفل المهمة', en: 'Mission lease' },
    'system.taskLeases': { ar: 'أقفال المهام', en: 'Task leases' },
    'system.checkpoints': { ar: 'نقاط التحقق', en: 'Checkpoints' },
    'system.independentWorkers': { ar: 'عمال مستقلون', en: 'Independent workers' },
    'system.maxTasks': { ar: 'أقصى مهام متزامنة', en: 'Max concurrent tasks' },
    'system.leaseTtl': { ar: 'مدة القفل', en: 'Lease TTL' },
    'system.maxAttempts': { ar: 'أقصى محاولات', en: 'Max attempts' },
    'system.recovery': { ar: 'الاستعادة', en: 'Recovery' },
    'system.blockedTasks': { ar: 'مهام محظورة', en: 'Blocked tasks' },
    'system.pendingApprovals': { ar: 'موافقات معلّقة', en: 'Pending approvals' },
    'system.activeLeases': { ar: 'أقفال نشطة', en: 'Active leases' },
    'system.limitations': { ar: 'قيود معروفة', en: 'Known limitations' },
    'system.noQueue': { ar: 'لا توجد طابور موزع أو إجماع بين المضيفين.', en: 'No distributed queue or cross-host consensus.' },
    'system.noCalls': { ar: '0 استدعاءات مسجلة', en: '0 recorded calls' },
    'system.usageNote': { ar: 'أرقام الرموز تقديرية (حرف/4) والتكلفة تقريبية. ليست للفوترة.', en: 'Token figures are character/4 estimates and cost is approximate. Not billing-grade.' },
    'system.noDenialsBody': { ar: 'لا توجد واجهة مخصصة لسجل رفض الصلاحيات. ستظهر حالات الرفض في سياقها وفي سجل التدقيق.', en: 'There is no dedicated denial feed. Denials will appear in context and in the audit log.' },
    'inspector.title': { ar: 'المفتش', en: 'Inspector' },
    'inspector.select': { ar: 'اختر مهمة أو عنصراً لعرض تفاصيله.', en: 'Select a task or object to inspect it.' },
    'inspector.identity': { ar: 'الهوية', en: 'Identity' },
    'inspector.why': { ar: 'لماذا', en: 'Why' },
    'inspector.evidence': { ar: 'الأدلة', en: 'Evidence' },
    'inspector.authority': { ar: 'الصلاحية', en: 'Authority' },
    'inspector.raw': { ar: 'البيانات الخام', en: 'Raw' },
    'inspector.noRuns': { ar: 'لم تُسجّل محاولات. المهمة محظورة قبل بدء التنفيذ.', en: 'No runs recorded. The task is blocked before execution.' },
    'inspector.noSnapshot': { ar: 'لا توجد لقطة قدرات — المهمة لم تبدأ.', en: 'No capability snapshot — the task has not started.' },
    'inspector.tools': { ar: 'الأدوات المسموحة', en: 'Allowed tools' },
    'inspector.skills': { ar: 'المهارات المسندة', en: 'Assigned skills' },
    'inspector.plugins': { ar: 'الإضافات المسندة', en: 'Assigned plugins' },
    'inspector.limits': { ar: 'الحدود', en: 'Limits' },
    'inspector.runEvidence': { ar: 'دليل المحاولة {n}', en: 'Attempt {n} evidence' },
    'inspector.model': { ar: 'النموذج', en: 'Model' },
    'inspector.role': { ar: 'الدور', en: 'Role' },
    'inspector.capabilityDigest': { ar: 'بصمة القدرات', en: 'Capability digest' },
    'inspector.installState': { ar: 'حالة التثبيت', en: 'Install state' },
    'inspector.executionModel': { ar: 'نموذج التنفيذ', en: 'Execution model' },
    'inspector.manifest': { ar: 'البيان', en: 'Manifest' },
    'approval.title': { ar: 'مراجعة الموافقة', en: 'Review approval' },
    'approval.titleHigh': { ar: 'موافقة عالية الخطورة', en: 'High-risk approval' },
    'approval.action': { ar: 'الإجراء المطلوب', en: 'Requested action' },
    'approval.target': { ar: 'الهدف', en: 'Target' },
    'approval.consequences': { ar: 'العواقب', en: 'Consequences' },
    'approval.resources': { ar: 'أثر الموارد', en: 'Resource impact' },
    'approval.exactPayload': { ar: 'الحمولة الدقيقة', en: 'Exact payload' },
    'approval.payloadDigest': { ar: 'بصمة الحمولة', en: 'Payload digest' },
    'approval.reviewDigest': { ar: 'بصمة المراجعة', en: 'Review digest' },
    'approval.requestedBy': { ar: 'طُلبت بواسطة', en: 'Requested by' },
    'approval.expires': { ar: 'تنتهي', en: 'Expires' },
    'approval.approve': { ar: 'اعتماد', en: 'Approve' },
    'approval.reject': { ar: 'رفض', en: 'Reject' },
    'approval.prototypeNote': { ar: 'النموذج لا يرسل القرار. في الإنتاج سيستدعي POST /api/os/approvals/{id}/decide.', en: 'The prototype does not send a decision. Production will call POST /api/os/approvals/{id}/decide.' },
    'approval.noPending': { ar: 'لا توجد موافقات معلّقة.', en: 'No pending approvals.' },
    'approval.pendingCount': { ar: '{n} معلّقة', en: '{n} pending' },
    'approval.taskBlocked': { ar: 'المهمة المحظورة', en: 'Blocked task' },
    'missionSwitcher.title': { ar: 'المهام', en: 'Missions' },
    'missionSwitcher.sub': { ar: 'اختر مهمة للحفاظ على السياق.', en: 'Select a mission to preserve context.' },
    'missionSwitcher.onlyOne': { ar: 'مهمة واحدة في هذه المساحة.', en: 'One mission in this workspace.' },
    'missionSwitcher.current': { ar: 'الحالية', en: 'Current' },
    'palette.title': { ar: 'الأوامر', en: 'Commands' },
    'palette.placeholder': { ar: 'ابحث عن منطقة أو إجراء…', en: 'Search zones or actions…' },
    'palette.empty': { ar: 'لا توجد أوامر مطابقة.', en: 'No matching commands.' },
    'palette.goBrief': { ar: 'الانتقال إلى الموجز', en: 'Go to Brief' },
    'palette.goRun': { ar: 'الانتقال إلى التشغيل', en: 'Go to Run' },
    'palette.goLibrary': { ar: 'الانتقال إلى المكتبة', en: 'Go to Library' },
    'palette.goCap': { ar: 'الانتقال إلى القدرات', en: 'Go to Capabilities' },
    'palette.goSystem': { ar: 'الانتقال إلى النظام', en: 'Go to System' },
    'palette.reviewApproval': { ar: 'مراجعة الموافقة المعلّقة', en: 'Review pending approval' },
    'palette.inspectBlocked': { ar: 'فحص المهمة المحظورة', en: 'Inspect blocked task' },
    'palette.openArtifact': { ar: 'فتح مخرج المهمة', en: 'Open mission artifact' },
    'palette.toggleTheme': { ar: 'تبديل الوضع الفاتح/الداكن', en: 'Toggle light/dark' },
    'palette.toggleLang': { ar: 'تبديل اللغة', en: 'Switch language' },
    'toast.recorded': { ar: 'النموذج للقراءة فقط. لم يتم إرسال أي تغيير.', en: 'Read-only prototype. No change was sent.' },
    'toast.copied': { ar: 'تم النسخ إلى الحافظة.', en: 'Copied to clipboard.' },
    'toast.preview': { ar: 'هذه معاينة تصميم. الإنتاج سيستدعي واجهة WORA الحقيقية.', en: 'This is a design preview. Production will call the real WORA API.' },
    'error.title': { ar: 'تعذّر تحميل اللقطة', en: 'Could not load the snapshot' },
    'error.body': { ar: 'شغّل النموذج من مجلد prototype عبر خادم HTTP، وليس بفتح الملف مباشرة.', en: 'Serve the prototype from the prototype folder over HTTP; do not open the file directly.' }
  });

  const renderInspector = () => {
    if (!D) return '';
    if (state.zone === 'capabilities') {
      if (state.capTab === 'agents') {
        if (selectedAgent()) return renderAgentInspector(selectedAgent());
        return `<div class="inspector-head"><div class="inspector-eyebrow">${icon('bot', 12)} <span>${esc(t('zone.agents'))}</span></div><div class="inspector-title">${esc(t('cap.selectAgentTitle'))}</div><div class="inspector-sub">${esc(t('cap.selectAgentDesc'))}</div></div><div class="inspector-body"><section class="inspector-section"><div class="inspector-label">${esc(t('cap.registry'))}</div><p class="small muted">${esc(t('cap.registrySummary', { agents: D.agents?.length || 0, n: D.packages?.length || 0 }))}</p></section></div>`;
      }
      if ((state.capTab === 'skills' || state.capTab === 'plugins') && state.selectedPackageId && selectedPackage()) return renderPackageInspector(selectedPackage());
      if (state.capTab === 'mcp') {
        return `<div class="inspector-head"><div class="inspector-eyebrow">${icon('plug', 12)} <span>MCP</span></div><div class="inspector-title">${esc(t('cap.mcpInspectorTitle'))}</div><div class="inspector-sub">${esc(t('cap.mcpInspectorDesc'))}</div></div><div class="inspector-body"><section class="inspector-section"><div class="inspector-label">${esc(t('cap.mcp'))}</div><p class="small muted">${esc(t('cap.mcpEmpty'))}</p></section><section class="inspector-section"><div class="inspector-label">${esc(t('common.noSecret'))}</div><p class="small muted">${esc(t('common.notBilling'))}</p></section></div>`;
      }
      return `<div class="inspector-head"><div class="inspector-eyebrow">${icon('layers', 12)} <span>${esc(t('cap.registry'))}</span></div><div class="inspector-title">${esc(t('cap.selectPackageTitle'))}</div><div class="inspector-sub">${esc(t('cap.selectPackageBody'))}</div></div><div class="inspector-body"><section class="inspector-section"><div class="inspector-label">${esc(t('cap.registry'))}</div><p class="small muted">${esc(t('cap.registrySummary', { agents: D.agents?.length || 0, n: D.packages?.length || 0 }))}</p><div class="notice brand" style="margin-block-start:10px">${esc(t('cap.registrySource'))}</div></section><section class="inspector-section"><div class="inspector-label">${esc(t('common.noSecret'))}</div><p class="small muted">${esc(t('common.notBilling'))}</p></section></div>`;
    }


    if (state.zone === 'library') {
      if (state.libraryTab === 'memory') return renderMemoryInspector();
      if (state.libraryTab === 'knowledge') return renderKnowledgeInspector();
      return renderArtifactInspector();
    }
    if (state.zone === 'system') {
      if ((state.sheet === 'approval' || state.systemTab === 'approvals') && pendingApproval()) return renderApprovalInspector(pendingApproval());
      return `<div class="inspector-head"><div class="inspector-eyebrow">${icon('sliders', 12)} <span>${esc(t('zone.system'))}</span></div><div class="inspector-title">${esc(t('system.runtime'))}</div><div class="inspector-sub">${esc(t('app.recorded'))}</div></div><div class="inspector-body"><section class="inspector-section"><div class="inspector-label">${esc(t('system.limitations'))}</div><div class="limitations">${(D.runtime.limitations || []).slice(0, 3).map((limitation) => `<div class="limitation">${esc(limitationText(limitation))}</div>`).join('')}</div></section><section class="inspector-section"><div class="inspector-label">${esc(t('common.noSecret'))}</div><p class="small muted">${esc(t('common.notBilling'))}</p></section></div>`;
    }
    if (state.zone === 'brief') {
      return `<div class="inspector-head"><div class="inspector-eyebrow">${icon('pen', 12)} <span>${esc(t('zone.brief'))}</span></div><div class="inspector-title">${esc(t('app.prototype'))}</div><div class="inspector-sub">${esc(t('app.noMutation'))}</div></div><div class="inspector-body"><section class="inspector-section"><div class="inspector-label">${esc(t('brief.how'))}</div>${[['how1', 'how1Copy'], ['how2', 'how2Copy'], ['how3', 'how3Copy'], ['how4', 'how4Copy']].map(([a, b], i) => `<div class="check"><span class="check-icon pass">${pad(i + 1)}</span><span><strong>${esc(t('brief.' + a))}</strong><small>${esc(t('brief.' + b))}</small></span></div>`).join('')}</section></div>`;
    }
    return selectedTask() ? renderTaskInspector(selectedTask()) : `<div class="inspector-head"><div class="inspector-title">${esc(t('inspector.title'))}</div><div class="inspector-sub">${esc(t('inspector.select'))}</div></div>`;
  };



  const showToast = (message) => {
    const el = $('#toast');
    el.textContent = message;
    el.classList.add('is-visible');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => el.classList.remove('is-visible'), 2600);
  };

  const focusSheet = () => {
    requestAnimationFrame(() => {
      const target = $('#sheet-root .sheet [data-autofocus]') || $('#sheet-root .sheet button[data-action="close-sheet"]') || $('#sheet-root .sheet button');
      target?.focus();
    });
  };

  const closeSheet = () => {
    $('#sheet-root').innerHTML = '';
    state.sheet = null;
    document.body.style.removeProperty('overflow');
    if (state.returnFocus?.isConnected) state.returnFocus.focus();
    state.returnFocus = null;
  };

  const openApprovalSheet = () => {
    const approval = pendingApproval();
    if (!approval) { showToast(t('approval.noPending')); return; }
    state.returnFocus = document.activeElement;
    state.sheet = 'approval';
    document.body.style.overflow = 'hidden';
    $('#sheet-root').innerHTML = `<div class="sheet-backdrop" data-action="close-sheet"><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="approval-title" data-sheet>
      <div class="sheet-head"><span class="inspector-title" style="color:var(--signal)">${icon('alert', 18)}</span><div class="grow"><div class="sheet-title" id="approval-title">${esc(t('approval.titleHigh'))}</div><div class="sheet-sub">${esc(approval.toolId || approval.kind)} · ${esc(M.id)}</div></div><button class="icon-button" type="button" data-action="close-sheet" aria-label="${esc(t('common.close'))}">${icon('x', 16)}</button></div>
      <div class="sheet-body">
        <div class="approval-summary"><div class="approval-summary-title" dir="auto">${esc(approval.actionSummary)}</div><div class="approval-risk">${riskBadge(approval.risk)} ${badge(approval.actionClass ? 'Class ' + approval.actionClass : approval.kind, 'neutral')} <span class="mono faint">${esc(approval.scope || '')}</span></div></div>
        <dl class="kv approval-kv">
          <dt>${esc(t('approval.target'))}</dt><dd>${esc(approval.target || t('common.none'))}</dd>
          <dt>${esc(t('approval.consequences'))}</dt><dd>${esc(approval.consequences || t('common.none'))}</dd>
          <dt>${esc(t('approval.resources'))}</dt><dd>${esc(approval.resourceImpact || t('common.none'))}</dd>
          <dt>${esc(t('approval.requestedBy'))}</dt><dd>${esc(approval.requestedBy)}</dd>
          <dt>${esc(t('common.created'))}</dt><dd>${esc(date(approval.createdAt, state.locale))}</dd>
          <dt>${esc(t('approval.payloadDigest'))}</dt><dd class="mono ltr">${esc(approval.payloadDigest || '—')}</dd>
          <dt>${esc(t('approval.reviewDigest'))}</dt><dd class="mono ltr">${esc(approval.reviewDigest || '—')}</dd>
        </dl>
        <div class="inspector-label" style="margin-block-start:18px">${esc(t('approval.exactPayload'))}</div>
        <pre style="background:var(--terminal);color:var(--terminal-ink);padding:12px;direction:ltr;text-align:left;font-family:var(--mono);font-size:10px;line-height:1.55;overflow:auto;max-height:230px">${esc(JSON.stringify(approval.toolInput, null, 2))}</pre>
        <div class="notice" style="margin-block-start:16px">${esc(t('approval.prototypeNote'))}</div>
      </div>
      <div class="sheet-foot"><span class="note">${esc(t('common.prototypeOnly'))}</span><button class="btn" disabled>${esc(t('approval.reject'))}</button><button class="btn btn-primary" disabled>${esc(t('approval.approve'))}</button></div>
    </div></div>`;
    focusSheet();
  };

  const openMissionSheet = () => {
    state.returnFocus = document.activeElement;
    state.sheet = 'missions';
    document.body.style.overflow = 'hidden';
    $('#sheet-root').innerHTML = `<div class="sheet-backdrop" data-action="close-sheet"><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="missions-title" data-sheet>
      <div class="sheet-head"><div class="grow"><div class="sheet-title" id="missions-title">${esc(t('missionSwitcher.title'))}</div><div class="sheet-sub">${esc(t('missionSwitcher.sub'))}</div></div><button class="icon-button" type="button" data-action="close-sheet" aria-label="${esc(t('common.close'))}">${icon('x', 16)}</button></div>
      <div class="sheet-body"><div class="recent-list">${M ? `<button class="recent-row" type="button" data-action="go" data-zone="run"><span><span class="recent-title" dir="auto">${esc(M.objective)}</span><span class="recent-meta">${statusBadge(M.status)}<span>${completedTasks().length}/${taskCount()}</span><span>${esc(shortDate(M.updatedAt, state.locale))}</span><span>${badge(t('missionSwitcher.current'), 'brand')}</span></span></span>${icon('arrowRight', 14)}</button>` : ''}</div><div class="notice" style="margin-block-start:16px">${esc(t('missionSwitcher.onlyOne'))}</div></div>
    </div></div>`;
    focusSheet();
  };

  const openInspectorSheet = () => {
    state.returnFocus = document.activeElement;
    state.sheet = 'inspector';
    document.body.style.overflow = 'hidden';
    $('#sheet-root').innerHTML = `<div class="sheet-backdrop" data-action="close-sheet"><div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(t('inspector.title'))}" data-sheet>
      <button class="icon-button sheet-close" type="button" data-action="close-sheet" aria-label="${esc(t('common.close'))}">${icon('x', 16)}</button>
      <div class="sheet-body" style="padding:0">${renderInspector()}</div>
    </div></div>`;
    focusSheet();
  };

  const paletteCommands = () => [
    { id: 'brief', label: t('palette.goBrief'), icon: 'pen', run: () => go('brief') },
    { id: 'run', label: t('palette.goRun'), icon: 'play', run: () => go('run') },
    { id: 'library', label: t('palette.goLibrary'), icon: 'library', run: () => go('library') },
    { id: 'capabilities', label: t('palette.goCap'), icon: 'layers', run: () => go('capabilities') },
    { id: 'system', label: t('palette.goSystem'), icon: 'sliders', run: () => go('system') },
    { id: 'approval', label: t('palette.reviewApproval'), icon: 'shield', run: () => { closePalette(); openApprovalSheet(); } },
    { id: 'blocked', label: t('palette.inspectBlocked'), icon: 'alert', run: () => { closePalette(); state.zone = 'run'; state.selectedTaskId = blockedTask()?.id || state.selectedTaskId; render(); } },
    { id: 'artifact', label: t('palette.openArtifact'), icon: 'file', run: () => { closePalette(); go('run'); state.tab = 'artifact'; render(); } },
    { id: 'theme', label: t('palette.toggleTheme'), icon: 'sun', run: () => { closePalette(); toggleTheme(); } },
    { id: 'lang', label: t('palette.toggleLang'), icon: 'globe', run: () => { closePalette(); toggleLang(); } }
  ];

  const renderPalette = (query = '', active = 0) => {
    const commands = paletteCommands().filter((command) => command.label.toLowerCase().includes(query.toLowerCase()));
    const root = $('#palette-root');
    root.innerHTML = `<div class="palette-backdrop" data-action="close-palette"><div class="palette" role="dialog" aria-modal="true" aria-label="${esc(t('palette.title'))}"><div class="palette-search">${icon('search', 16)}<input id="palette-input" value="${esc(query)}" placeholder="${esc(t('palette.placeholder'))}" aria-label="${esc(t('palette.placeholder'))}" /></div><div class="palette-list">${commands.length ? commands.map((command, index) => `<button class="palette-item ${index === active ? 'is-active' : ''}" type="button" data-action="palette-command" data-command="${command.id}">${icon(command.icon, 14)}<span>${esc(command.label)}</span><span class="shortcut">${index < 5 ? 'G ' + 'BRLCS'[index] : '↵'}</span></button>`).join('') : `<div class="palette-empty">${esc(t('palette.empty'))}</div>`}</div></div></div>`;
    const input = $('#palette-input');
    input?.focus();
    input?.setSelectionRange(query.length, query.length);
    input?.addEventListener('input', () => renderPalette(input.value, 0));
  };

  const openPalette = () => { state.palette = true; renderPalette(); };
  const closePalette = () => { state.palette = false; $('#palette-root').innerHTML = ''; };

  const toggleTheme = () => {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('wora-proto-theme', state.theme);
    applyTheme();
    render();
  };
  const toggleLang = () => {
    state.locale = state.locale === 'ar' ? 'en' : 'ar';
    localStorage.setItem('wora-proto-locale', state.locale);
    applyDirection();
    render();
  };
  const applyTheme = () => { document.documentElement.dataset.theme = state.theme; };
  const applyDirection = () => { document.documentElement.lang = state.locale; document.documentElement.dir = state.locale === 'ar' ? 'rtl' : 'ltr'; };

  const syncHash = () => {
    let hash = `#/${state.zone}`;
    if (state.zone === 'run') hash += `/${state.tab}`;
    if (state.zone === 'library') hash += `/${state.libraryTab}`;
    if (state.zone === 'capabilities') hash += `/${state.capTab}`;
    if (state.zone === 'system') hash += `/${state.systemTab}`;
    history.replaceState(null, '', hash);
  };

  const go = (zone, options = {}) => {
    state.zone = zone;
    if (zone !== 'capabilities') { state.selectedPackageId = null; }
    closeSheet();
    closePalette();
    syncHash();
    render();
    if (!options.keepScroll) $('#workspace').scrollTo?.({ top: 0 });
  };

  const selectTask = (id) => {
    state.selectedTaskId = id;
    render();
    if (window.matchMedia('(max-width: 1100px)').matches) openInspectorSheet();
  };

  const selectAgent = (id) => {
    state.selectedAgentId = id;
    state.selectedPackageId = null;
    render();
    if (window.matchMedia('(max-width: 1100px)').matches) openInspectorSheet();
  };

  const selectPackage = (id) => {
    state.selectedPackageId = id;
    state.selectedAgentId = null;
    render();
    if (window.matchMedia('(max-width: 1100px)').matches) openInspectorSheet();
  };

  const copyValue = async (value) => {
    try { await navigator.clipboard.writeText(value); showToast(t('toast.copied')); }
    catch { showToast(t('app.noMutation')); }
  };

  const downloadArtifact = () => {
    if (!D.artifact) return;
    const blob = new Blob([D.artifact.content], { type: 'text/markdown' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = D.artifact.name;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const render = () => {
    applyTheme();
    applyDirection();
    if (!D) return;
    const inspector = renderInspector();
    renderTopbar();
    renderRail();
    renderMobileNav();
    renderRuntimeStrip();
    const content = state.zone === 'brief' ? renderBrief() : state.zone === 'library' ? renderLibrary() : state.zone === 'capabilities' ? renderCapabilities() : state.zone === 'system' ? renderSystem() : renderRun();
    $('#workspace').innerHTML = content;
    $('#inspector').innerHTML = inspector;
    bindDynamic();
  };

  const bindDynamic = () => {
    const input = $('#cap-search');
    if (input) {
      input.addEventListener('input', () => {
        state.filter = input.value;
        render();
        const next = $('#cap-search');
        if (next) { next.focus(); next.setSelectionRange(next.value.length, next.value.length); }
      });
    }
    const brief = $('#brief-input');
    if (brief) brief.addEventListener('input', () => { /* draft is local; no backend mutation */ });
  };

  const onPaletteKey = (event) => {
    if (!state.palette) return;
    const input = $('#palette-input');
    const query = input?.value || '';
    const items = paletteCommands().filter((command) => command.label.toLowerCase().includes(query.toLowerCase()));
    if (event.key === 'Escape') { event.preventDefault(); closePalette(); return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const active = Math.max(0, $$('.palette-item').findIndex((el) => el.classList.contains('is-active')));
      const next = Math.max(0, Math.min(items.length - 1, active + (event.key === 'ArrowDown' ? 1 : -1)));
      renderPalette(query, next);
      return;
    }
    if (event.key === 'Enter' && items[0]) { event.preventDefault(); items[Math.max(0, $$('.palette-item').findIndex((el) => el.classList.contains('is-active')))]?.run(); }
  };

  const onClick = (event) => {
    const actionEl = event.target.closest('[data-action]');
    if (!actionEl) return;
    const action = actionEl.dataset.action;
    if (action === 'close-sheet' && event.target.closest('[data-sheet]') && !event.target.closest('[data-action="close-sheet"]')) return;
    if (action === 'close-palette' && event.target.closest('.palette')) return;
    switch (action) {
      case 'go': go(actionEl.dataset.zone); break;
      case 'open-approval':
        if (window.matchMedia('(max-width: 1100px)').matches) { openApprovalSheet(); } else { state.sheet = 'approval'; state.zone = state.zone === 'system' ? 'system' : state.zone; openApprovalSheet(); }
        break;
      case 'mission-switcher': openMissionSheet(); break;
      case 'close-sheet': closeSheet(); break;
      case 'palette': openPalette(); break;
      case 'close-palette': closePalette(); break;
      case 'palette-command': { const command = paletteCommands().find((item) => item.id === actionEl.dataset.command); command?.run(); break; }
      case 'toggle-theme': toggleTheme(); break;
      case 'toggle-lang': toggleLang(); break;
      case 'tab': state.tab = actionEl.dataset.tab; syncHash(); render(); break;
      case 'library-tab': state.libraryTab = actionEl.dataset.tab; syncHash(); render(); break;
      case 'cap-tab': state.capTab = actionEl.dataset.tab; state.filter = ''; state.selectedPackageId = null; if (state.capTab !== 'agents') state.selectedAgentId = null; syncHash(); render(); break;
      case 'system-tab': state.systemTab = actionEl.dataset.tab; syncHash(); render(); break;
      case 'activity-filter': state.activityFilter = actionEl.dataset.filter; render(); break;
      case 'select-task': selectTask(actionEl.dataset.id); break;
      case 'select-agent': selectAgent(actionEl.dataset.id); break;
      case 'select-package': selectPackage(actionEl.dataset.id); break;
      case 'open-artifact': state.zone = 'run'; state.tab = 'artifact'; closeSheet(); render(); break;
      case 'artifact-raw': state.artifactRaw = !state.artifactRaw; render(); break;
      case 'download-artifact': downloadArtifact(); break;
      case 'copy': copyValue(actionEl.dataset.copy || ''); break;
      case 'preview-intent': showToast(t('toast.preview')); break;
      case 'example': { const box = $('#brief-input'); if (box) { box.value = actionEl.dataset.text || ''; box.focus(); } break; }
      case 'phase': {
        const phase = actionEl.dataset.phase;
        if (phase === 'verify') state.tab = 'evidence';
        else if (phase === 'deliver') state.tab = 'artifact';
        else if (phase === 'understand' || phase === 'plan' || phase === 'assign' || phase === 'execute') state.tab = 'plan';
        if (phase === 'understand') state.tab = 'context';
        render(); break;
      }
      default: break;
    }
  };

  const onKey = (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); openPalette(); return; }
    if (state.palette) { onPaletteKey(event); return; }
    const tab = event.target.closest('[role="tab"]');
    if (tab && ['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) {
      const tabs = [...tab.closest('[role="tablist"]').querySelectorAll('[role="tab"]')];
      const current = tabs.indexOf(tab);
      const rtl = document.documentElement.dir === 'rtl';
      let next = current;
      if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = tabs.length - 1;
      else if (event.key === 'ArrowRight') next = rtl ? current - 1 : current + 1;
      else if (event.key === 'ArrowLeft') next = rtl ? current + 1 : current - 1;
      next = (next + tabs.length) % tabs.length;
      event.preventDefault();
      tabs[next].focus();
      tabs[next].click();
      requestAnimationFrame(() => document.querySelector('[role="tab"][aria-selected="true"]')?.focus());
      return;
    }
    if (event.key === 'Escape') { closeSheet(); closePalette(); return; }
    if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('.ledger-row, .ledger-status .action')) { event.preventDefault(); event.target.click(); return; }
    if (event.target.closest('input, textarea')) return;
    if (event.key.toLowerCase() === 'g') { state.gPrefix = true; setTimeout(() => { state.gPrefix = false; }, 900); return; }
    if (state.gPrefix) {
      const zones = { b: 'brief', r: 'run', l: 'library', c: 'capabilities', s: 'system' };
      const zone = zones[event.key.toLowerCase()];
      if (zone) { event.preventDefault(); go(zone); }
      state.gPrefix = false;
    }
  };

  const parseRoute = () => {
    const hash = window.location.hash.replace(/^#\/?/, '').split('/');
    if (['brief', 'run', 'library', 'capabilities', 'system'].includes(hash[0])) state.zone = hash[0];
    if (hash[0] === 'run' && ['plan', 'activity', 'evidence', 'artifact', 'context'].includes(hash[1])) state.tab = hash[1];
    if (hash[0] === 'library' && ['artifacts', 'memory', 'knowledge'].includes(hash[1])) state.libraryTab = hash[1];
    if (hash[0] === 'capabilities' && ['agents', 'skills', 'plugins', 'mcp'].includes(hash[1])) state.capTab = hash[1];
    if (hash[0] === 'system' && ['runtime', 'approvals', 'usage'].includes(hash[1])) state.systemTab = hash[1];
  };

  window.addEventListener('hashchange', () => {
    parseRoute();
    render();
  });

  const boot = async () => {
    applyTheme();
    applyDirection();
    try {
      const response = await fetch('data/snapshot.json');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      D = await response.json();
      D.state.installed = (D.packages || []).filter((pkg) => pkg.installed).length;
      M = D.mission;
      state.selectedTaskId = blockedTask()?.id || M.tasks?.[0]?.id || null;
      state.selectedAgentId = D.agents?.[0]?.id || null;
      const params = new URLSearchParams(window.location.search);
      if (params.get('lang') === 'en' || params.get('lang') === 'ar') state.locale = params.get('lang');
      if (params.get('theme') === 'dark' || params.get('theme') === 'light') state.theme = params.get('theme');
      parseRoute();
      render();
    } catch (error) {
      $('#workspace').innerHTML = `<div class="page"><div class="empty" style="margin-block-start:60px">${icon('alert', 24, 'empty-icon')}<h3>${esc(t('error.title'))}</h3><p>${esc(t('error.body'))}</p><p class="mono micro" style="margin-block-start:12px">${esc(error.message)}</p></div></div>`;
      $('#inspector').innerHTML = '';
    }
  };

  document.addEventListener('click', onClick);
  document.addEventListener('keydown', onKey);
  window.addEventListener('hashchange', () => {
    const hash = window.location.hash.replace(/^#\/?/, '').split('/');
    if (['brief', 'run', 'library', 'capabilities', 'system'].includes(hash[0]) && hash[0] !== state.zone) { state.zone = hash[0]; render(); }
  });

  boot();
})();
