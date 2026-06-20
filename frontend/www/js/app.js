const { createApp, ref, computed, watch, nextTick, onMounted } = Vue;
const { ElMessage, ElMessageBox } = ElementPlus;

const app = Vue.createApp({
  setup() {
    const apiBase = ref('/api');
    const token = ref(localStorage.getItem('token') || '');
    const currentUser = ref(JSON.parse(localStorage.getItem('currentUser') || 'null'));
    const isLoggedIn = computed(() => !!token.value);

    const loginForm = ref({ username: '', password: '' });
    const loginLoading = ref(false);
    const currentPage = ref('consultation');
    const sidebarOpen = ref(false);
    const drawerOpen = ref(false);
    const pageTitle = computed(() => {
      const titles = {
        'consultation': '💬 个体化精准调养',
        'history': '📋 问诊记录',
        'local-cases': '📁 本地案例',
        'knowledge': '📚 知识库管理',
        'users': '👥 用户管理',
        'analytics': '📊 数据统计',
        'hot-symptoms': '🔥 热门症状',
        'region-manage': '🗺️ 区域管理',
        'inventory': '📦 库存管理',
      };
      return titles[currentPage.value] || '精准养生';
    });

    const roleLabels = {
      super_admin: '超级管理员', admin: '管理员',
      province_manager: '省级总经理', region_manager: '地区经理',
      business_manager: '业务经理', user: '普通用户'
    };

    const canManageUsers = computed(() => ['super_admin','admin','province_manager','region_manager','business_manager'].includes(currentUser.value?.role));
    const canViewAnalytics = computed(() => ['super_admin','admin','province_manager','region_manager','business_manager'].includes(currentUser.value?.role));

    const creatableRoles = computed(() => {
      const r = currentUser.value?.role;
      const map = {
        super_admin: ['admin','province_manager','region_manager','business_manager','user'],
        admin: ['province_manager','region_manager','business_manager','user'],
        province_manager: ['region_manager','business_manager','user'],
        region_manager: ['business_manager','user'],
        business_manager: ['user'],
      };
      return map[r] || [];
    });

    const authHeaders = computed(() => ({ Authorization: `Bearer ${token.value}` }));

    async function api(url, opts = {}) {
      const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token.value}`, ...opts.headers };
      let res;
      try {
        res = await fetch(apiBase.value + url, { ...opts, headers });
      } catch (e) {
        throw new Error('网络请求失败，请检查网络连接');
      }
      if (res.status === 401) { handleLogout(); throw new Error('登录过期'); }
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.detail || `请求失败(${res.status})`); }
      return res.json();
    }

    // Login
    // apiBase is fixed to /api (same origin)


    async function handleLogin() {
      loginLoading.value = true;
      //
      try {
        const data = await api('/auth/login', { method: 'POST', body: JSON.stringify(loginForm.value) });
        token.value = data.access_token;
        currentUser.value = data.user;
        localStorage.setItem('token', data.access_token);
        localStorage.setItem('currentUser', JSON.stringify(data.user));
        ElMessage.success('登录成功');
        // 直接使用登录返回的知识库ID设置consultKB
        if (data.user && data.user.knowledge_base_ids && data.user.knowledge_base_ids.length > 0) {
          consultKB.value = data.user.knowledge_base_ids[0];
        }
        loadMyKnowledgeBases();
      } catch (e) { ElMessage.error(e.message); }
      loginLoading.value = false;
    }

    function handleLogout() {
      token.value = ''; currentUser.value = null;
      localStorage.removeItem('token'); localStorage.removeItem('currentUser');
      currentPage.value = 'consultation';
      followUpFromCaseId.value = null;
      tongueImageBase64.value = ''; tongueImagePreview.value = '';
    }

    // Consultation
    const consultInput = ref('');
    const consultKB = ref(null);
    const consultMessages = ref([]);
    const consultLoading = ref(false);
    const tongueImageBase64 = ref('');
    const tongueImagePreview = ref('');
    const myKnowledgeBases = ref([]);

    async function loadMyKnowledgeBases() {
      try {
        myKnowledgeBases.value = await api('/my/knowledge-bases');
        if (myKnowledgeBases.value.length > 0 && !consultKB.value) {
          consultKB.value = myKnowledgeBases.value[0].id;
        }
      } catch {}
    }

    function handleTongueImage(file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        tongueImagePreview.value = e.target.result;
        tongueImageBase64.value = e.target.result.split(',')[1];
      };
      reader.readAsDataURL(file.raw);
    }

    async function sendConsultation() {
      if (!consultInput.value.trim() && !tongueImageBase64.value) return;
      const userMsg = consultInput.value || '请分析我的舌象';
      consultMessages.value.push({ role: 'user', content: userMsg, hasTongue: !!tongueImageBase64.value, tonguePreview: tongueImagePreview.value });
      consultLoading.value = true;
      const q = consultInput.value;
      consultInput.value = '';
      const savedTongueBase64 = tongueImageBase64.value;
      const savedTonguePreview = tongueImagePreview.value;
      tongueImageBase64.value = ''; tongueImagePreview.value = '';
      try {
        const data = await api('/consultations', {
          method: 'POST',
          body: JSON.stringify({ question: q, knowledge_base_id: consultKB.value, tongue_image_base64: savedTongueBase64 || null }),
        });
        // Typewriter effect
        const aiMsg = { role: 'ai', content: '', id: data.id, saved: false, streaming: true };
        consultMessages.value.push(aiMsg);
        const msgIndex = consultMessages.value.length - 1;
        const fullText = data.reply || data.answer || '';
        const chars = [...fullText];
        const step = Math.max(1, Math.ceil(chars.length / 120)); // finish in ~2s
        for (let i = 0; i < chars.length; i += step) {
          consultMessages.value[msgIndex].content = chars.slice(0, i + step).join('');
          await nextTick();
          const el = document.querySelector('.chat-messages');
          if (el) el.scrollTop = el.scrollHeight;
          await new Promise(r => setTimeout(r, 16));
        }
        consultMessages.value[msgIndex].content = fullText;
        consultMessages.value[msgIndex].streaming = false;
      } catch (e) {
        ElMessage.error('问诊失败: ' + e.message);
      }
      consultLoading.value = false;
      await nextTick();
      const el = document.querySelector('.chat-messages');
      if (el) el.scrollTop = el.scrollHeight;

      // If this is a follow-up visit, link to parent case
      if (followUpFromCaseId.value && data && data.reply) {
        const parentCase = getLocalCasesFromStorage().find(c => c.id === followUpFromCaseId.value);
        if (parentCase) {
          const visit = {
            id: Date.now(),
            date: new Date().toISOString(),
            question: q || parentCase.question || '',
            answer: data.reply || '',
            tongue_image: savedTongueBase64 ? 'data:image/jpeg;base64,' + savedTongueBase64 : '',
          };
          addVisitToCase(parentCase, visit);
          ElMessage.success('复诊记录已关联到原案例');
        }
        followUpFromCaseId.value = null;
      }
    }

    async function saveToLocal(msg) {
      openSaveCaseDialog(msg);
    }

    function formatAIAnswer(text) {
      if (!text) return '';
      const sectionHeaders = ['舌象辨析','综合辨证','养生方案','药食同源方案','饮食调养','起居调摄','运动导引','情志调养','穴位按摩','季节养生'];
      let html = text
        // Remove markdown bold/italic symbols
        .replace(/\*\*(.+?)\*\*/g, '$1')
        .replace(/\*(.+?)\*/g, '$1')
        // Remove decorative symbols
        .replace(/[◆▶►※☆★○●◎◇□■△▲▽▼]/g, '')
        // Convert —— separator lines to styled dividers
        .replace(/^\s*——+\s*$/gm, '<div class="ai-divider"></div>')
        // Section headers: short standalone Chinese lines matching known titles
        .replace(/^\s*([\u4e00-\u9fff]{2,8})\s*$/gm, function(m, t) {
          if (sectionHeaders.includes(t)) return '<div class="ai-section-title">' + t + '</div>';
          return m;
        })
        // Sub-section: 第X阶段
        .replace(/^\s*(第[一二三四五六七八九十]+阶段[^\n]*)/gm, '<div class="ai-sub-title">$1</div>')
        // Numbered items
        .replace(/^\s*(\d+)\.\s*/gm, '<span class="ai-num">$1.</span> ')
        // Bold key before colon
        .replace(/([\u4e00-\u9fff]{1,10})[：:]/g, '<span class="ai-label">$1</span>：')
        // Line breaks
        .replace(/\n/g, '<br/>');
      return html;
    }

    // History
    const consultations = ref([]);
    const loadingHistory = ref(false);
    const showConsultDialog = ref(false);
    const selectedConsultation = ref(null);

    async function loadHistory() {
      loadingHistory.value = true;
      try { consultations.value = await api('/consultations'); } catch {}
      loadingHistory.value = false;
    }

    function viewConsultation(row) { selectedConsultation.value = row; showConsultDialog.value = true; }
    async function saveConsultation(id) {
      try {
        // Find the consultation in the list first
        const existing = consultations.value.find(c => c.id === id);
        if (existing) {
          _fillSaveCaseForm(existing, id);
          return;
        }
        // Fallback: fetch from server
        const res = await api(`/consultations/${id}`);
        _fillSaveCaseForm(res, id);
      } catch (e) { 
        console.error('saveConsultation error:', e);
        ElMessage.error('加载问诊记录失败: ' + e.message); 
      }
    }

    function _fillSaveCaseForm(data, consultationId) {
      let tongueBase64 = '';
      let tonguePreview = '';
      if (data.tongue_image_base64) {
        tongueBase64 = data.tongue_image_base64;
        tonguePreview = 'data:image/jpeg;base64,' + tongueBase64;
      }
      saveCaseForm.value = {
        consultation_id: consultationId,
        patient_name: '',
        patient_gender: '男',
        patient_age: '',
        patient_phone: '',
        patient_address: '',
        question: data.question || '',
        answer: data.reply || data.answer || '',
        tongue_analysis: data.tongue_analysis || '',
        syndrome_analysis: data.syndrome_analysis || '',
        symptoms: data.symptoms || [],
        tongue_image: tonguePreview,
        tongue_image_base64: tongueBase64,
      };
      showSaveCaseDialog.value = true;
    }

    // Local Cases (localStorage only — no server storage)
    const localCases = ref([]);
    const caseSearch = ref('');
    const showSaveCaseDialog = ref(false);
    const saveCaseForm = ref({ consultation_id: null, patient_name: '', patient_gender: '男', patient_age: '', patient_phone: '', patient_address: '', question: '', answer: '', tongue_analysis: '', syndrome_analysis: '', symptoms: [], tongue_image: '', tongue_image_base64: '' });
    const showLocalCaseDialog = ref(false);
    const selectedLocalCase = ref(null);
    const showTongueViewer = ref(false);
    const tongueViewerSrc = ref('');

    function viewTongueImage(src) {
      tongueViewerSrc.value = src;
      showTongueViewer.value = true;
    }

    function getLocalCasesFromStorage() {
      try {
        const uid = currentUser.value?.id || 'anonymous';
        const key = 'health_app_local_cases_' + uid;
        return JSON.parse(localStorage.getItem(key) || '[]');
      } catch { return []; }
    }

    function saveLocalCasesToStorage(cases) {
      const uid = currentUser.value?.id || 'anonymous';
      const key = 'health_app_local_cases_' + uid;
      localStorage.setItem(key, JSON.stringify(cases));
    }

    function loadLocalCases() {
      let cases = getLocalCasesFromStorage();
      // Filter by search
      if (caseSearch.value) {
        const s = caseSearch.value.trim().toLowerCase();
        cases = cases.filter(c =>
          (c.patient_name || '').toLowerCase().includes(s) ||
          (c.patient_phone || '').includes(s)
        );
      }
      // Sort by created_at desc
      cases.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      localCases.value = cases;
    }

    // Track which case we are doing a follow-up visit for
    const followUpFromCaseId = ref(null);

    function openSaveCaseDialog(msg) {
      // 从问诊消息中获取舌象图片
      let tongueBase64 = '';
      let tonguePreview = '';
      if (msg.tongue_image_base64) {
        tongueBase64 = msg.tongue_image_base64;
        tonguePreview = 'data:image/jpeg;base64,' + msg.tongue_image_base64;
      } else if (msg.hasTongue && msg.tonguePreview) {
        // 兼容旧格式：从 tonguePreview 中提取 base64
        tonguePreview = msg.tonguePreview;
        tongueBase64 = tonguePreview.split(',')[1] || '';
      }
      
      saveCaseForm.value = {
        consultation_id: msg.id,
        patient_name: '',
        patient_gender: '男',
        patient_age: '',
        patient_phone: '',
        patient_address: '',
        question: msg.question || (msg.content ? msg.content.substring(0, 200) : ''),
        answer: msg.content || '',
        tongue_analysis: msg.tongue_analysis || '',
        syndrome_analysis: msg.syndrome_analysis || '',
        symptoms: msg.symptoms || [],
        tongue_image: tonguePreview,
        tongue_image_base64: tongueBase64,
      };
      followUpFromCaseId.value = null;
      showSaveCaseDialog.value = true;
    }

    function submitSaveCase() {
      if (!saveCaseForm.value.patient_name.trim()) {
        ElMessage.warning('请输入患者姓名'); return;
      }
      const newCase = {
        id: Date.now(),
        patient_name: saveCaseForm.value.patient_name,
        patient_gender: saveCaseForm.value.patient_gender,
        patient_age: saveCaseForm.value.patient_age,
        patient_phone: saveCaseForm.value.patient_phone,
        patient_address: saveCaseForm.value.patient_address,
        question: saveCaseForm.value.question || '',
        answer: saveCaseForm.value.answer || '',
        tongue_analysis: saveCaseForm.value.tongue_analysis || '',
        syndrome_analysis: saveCaseForm.value.syndrome_analysis || '',
        symptoms: saveCaseForm.value.symptoms || [],
        tongue_image: saveCaseForm.value.tongue_image || '',
        tongue_image_base64: saveCaseForm.value.tongue_image_base64 || '',
        created_at: new Date().toISOString(),
        // Follow-up visit tracking
        parent_case_id: followUpFromCaseId.value || null,
        visits: [], // [{id, date, question, answer, tongue_image}]
      };
      const cases = getLocalCasesFromStorage();
      cases.push(newCase);
      saveLocalCasesToStorage(cases);
      ElMessage.success('案例已保存');
      showSaveCaseDialog.value = false;
      loadLocalCases();
    }

    function viewLocalCase(row) {
      selectedLocalCase.value = row;
      showLocalCaseDialog.value = true;
    }

    // Follow-up visit: open consultation page pre-filled with patient info
    function followUpCase(caseItem) {
      selectedLocalCase.value = caseItem;
      // Pre-fill consultation with patient info
      consultInput.value = caseItem.question || '';
      // If there's a tongue image, set it
      if (caseItem.tongue_image) {
        tongueImageBase64.value = caseItem.tongue_image;
        tongueImagePreview.value = caseItem.tongue_image;
      }
      // Switch to consultation page
      currentPage.value = 'consultation';
      // Store parent case ID for linking new visit
      followUpFromCaseId.value = caseItem.id;
      ElMessage.info('已携带患者信息到问诊页面，请补充症状后发送');
    }

    // Add a new visit to an existing case
    function addVisitToCase(caseItem, newVisit) {
      if (!caseItem.visits) {
        caseItem.visits = [];
      }
      caseItem.visits.push(newVisit);
      // Update in storage
      const cases = getLocalCasesFromStorage();
      const idx = cases.findIndex(c => c.id === caseItem.id);
      if (idx !== -1) {
        cases[idx] = caseItem;
        saveLocalCasesToStorage(cases);
      }
    }

    function deleteLocalCase(row) {
      if (!confirm('确定要删除此案例吗？')) return;
      let cases = getLocalCasesFromStorage();
      cases = cases.filter(c => c.id !== row.id);
      saveLocalCasesToStorage(cases);
      ElMessage.success('案例已删除');
      loadLocalCases();
    }

    // Knowledge Bases
    const knowledgeBases = ref([]);
    const allKBs = ref([]);
    const regionTree = ref([]);
    const loadRegionTree = async (kbId) => { try { const url = kbId ? `/regions/tree?kb_id=${kbId}` : '/regions/tree'; const r = await api(url); regionTree.value = (r.data || []); } catch(e) { console.error("Load regions failed", e); } };
    const loadingKB = ref(false);
    const showKBDialog = ref(false);
    const kbForm = ref({ name: '', description: '', prompt_config: '', negative_prompt: '' });
    const kbDialogTitle = ref('新建知识库');
    const savingKB = ref(false);
    const creatingKB = ref(false);
    const selectedKBDetail = ref(null);  // null=list view, object=detail view
    const kbDocuments = ref([]);
    const showBindDialog = ref(false);
    const bindUserIds = ref([]);
    const allUsers = ref([]);
    const bindingKB = ref(false);
    const showDocPreview = ref(false);
    const previewingDoc = ref(null);
    const docPreviewContent = ref('');
    const docPreviewLoading = ref(false);
    const selectedKBForBind = ref({});

    async function loadKB() {
      loadingKB.value = true;
      try { knowledgeBases.value = await api('/knowledge-bases'); }
      catch (e) { ElMessage.error('加载知识库失败: ' + e.message); }
      loadingKB.value = false;
    }
    async function loadAllKBs() {
      try {
        let data;
        if (currentUser.value?.role === 'super_admin') {
          data = await api('/knowledge-bases');
        } else {
          data = await api('/my/knowledge-bases');
        }
        allKBs.value = Array.isArray(data) ? data : [];
        console.log('loadAllKBs loaded:', allKBs.value.length, allKBs.value);
      } catch (e) {
        console.error('loadAllKBs error:', e);
        ElMessage.error('加载知识库失败: ' + e.message);
      }
    }
    async function createKB() {
      if (!kbForm.value.name.trim()) { ElMessage.warning('请输入知识库名称'); return; }
      creatingKB.value = true;
      try {
        const newKB = await api('/knowledge-bases', { method: 'POST', body: JSON.stringify(kbForm.value) });
        showKBDialog.value = false;
        ElMessage.success('创建成功');
        await loadKB();
        // Auto-open the new KB detail
        const created = knowledgeBases.value.find(k => k.id === newKB.id);
        if (created) openKBDetail(created);
      } catch (e) { ElMessage.error('创建失败: ' + e.message); }
      creatingKB.value = false;
    }
    async function deleteKB(id) {
      try { await ElMessageBox.confirm('确定删除此知识库？所有文档将一并删除', '提示', { type: 'warning' }); await api(`/knowledge-bases/${id}`, { method: 'DELETE' }); ElMessage.success('已删除'); if (selectedKBDetail.value && selectedKBDetail.value.id === id) selectedKBDetail.value = null; loadKB(); } catch {}
    }
    async function editKB(kb) {
      kbForm.value = { id: kb.id, name: kb.name, description: kb.description || '', prompt_config: kb.prompt_config || '', negative_prompt: kb.negative_prompt || '' };
      showKBDialog.value = true;
      kbDialogTitle.value = '编辑知识库';
    }
    async function saveKB() {
      if (!kbForm.value.name.trim()) { ElMessage.warning('请输入知识库名称'); return; }
      savingKB.value = true;
      try {
        if (kbForm.value.id) {
          await api(`/knowledge-bases/${kbForm.value.id}`, { method: 'PUT', body: JSON.stringify(kbForm.value) });
          ElMessage.success('更新成功');
        } else {
          const newKB = await api('/knowledge-bases', { method: 'POST', body: JSON.stringify(kbForm.value) });
          ElMessage.success('创建成功');
        }
        showKBDialog.value = false;
        await loadKB();
      } catch (e) { ElMessage.error('保存失败: ' + e.message); }
      savingKB.value = false;
    }
    async function openKBDetail(kb) {
      selectedKBDetail.value = kb;
      try { kbDocuments.value = await api(`/knowledge-bases/${kb.id}/documents`); } catch { kbDocuments.value = []; }
    }
    function docIcon(fileType) {
      const map = { '.txt': '📝', '.md': '📝', '.csv': '📊', '.json': '🔧', '.pdf': '📕', '.docx': '📘', '.doc': '📘', '.jpg': '🖼', '.jpeg': '🖼', '.png': '🖼', '.gif': '🖼', '.bmp': '🖼', '.webp': '🖼' };
      return map[fileType] || '📄';
    }
    async function previewDoc(doc) {
      previewingDoc.value = doc;
      showDocPreview.value = true;
      docPreviewLoading.value = true;
      docPreviewContent.value = '';
      try {
        // Fetch parsed content from API
        const docs = await api(`/knowledge-bases/${selectedKBDetail.value.id}/documents`);
        const found = docs.find(d => d.id === doc.id);
        docPreviewContent.value = found?.parsed_content || '';
        doc.parsed = !!found?.parsed_content;
      } catch { docPreviewContent.value = ''; }
      docPreviewLoading.value = false;
    }
    function onDocUploadSuccess(response) {
      ElMessage.success(`文件上传成功！${response.parsed ? '已自动解析入库' : '暂未能解析该格式'}`);
      openKBDetail(selectedKBDetail.value);
    }
    function onDocError() { ElMessage.error('文件上传失败，请检查文件格式'); }
    function beforeDocUpload(file) {
      const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
      const allowed = ['.txt', '.md', '.csv', '.json', '.pdf', '.docx', '.doc', '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'];
      if (!allowed.includes(ext)) {
        ElMessage.warning(`不支持的格式 ${ext}，目前仅支持: ${allowed.join(', ')}`);
        return false;
      }
      return true;
    }
    async function deleteDoc(kbId, docId) {
      try { await ElMessageBox.confirm('确定删除此文档？', '提示', { type: 'warning' }); await api(`/knowledge-bases/${kbId}/documents/${docId}`, { method: 'DELETE' }); ElMessage.success('已删除'); openKBDetail(selectedKBDetail.value); } catch {}
    }
    async function openBindDialog(kb) {
      try {
        allUsers.value = await api('/users');
        const bindings = await api(`/knowledge-bases/${kb.id}/bindings`);
        bindUserIds.value = bindings.map(b => b.user_id);
      } catch {}
      // Store which KB we're binding
      selectedKBForBind.value = kb;
      showBindDialog.value = true;
    }
    async function bindKB() {
      bindingKB.value = true;
      try { await api('/knowledge-bases/bind', { method: 'POST', body: JSON.stringify({ knowledge_base_id: selectedKBForBind.value.id, user_ids: bindUserIds.value }) }); showBindDialog.value = false; ElMessage.success('绑定成功'); loadKB(); } catch (e) { ElMessage.error(e.message); }
      bindingKB.value = false;
    }

    // Users
    const users = ref([]);
    const loadingUsers = ref(false);
    const showUserDialog = ref(false);
    const userForm = ref({ username: '', password: '', role: '', real_name: '', regions: [],  phone: '', validDateRange: null, knowledge_base_ids: [] });
    const editingUser = ref(null);
    const submittingUser = ref(false);
    const showChangePwdDialog = ref(false);
    const changePwdForm = ref({ old_password: '', new_password: '', confirm_password: '' });
    const changingPwd = ref(false);

    async function openCreateUserDialog() {
      editingUser.value = null;
      userForm.value = { 
        username: '', 
        password: '', 
        role: creatableRoles.value[0] || 'user', 
        real_name: '', 
        regions: [], 
        phone: '',
        validDateRange: null, 
        knowledge_base_ids: [] 
      };
      // Load all KBs if not loaded
      await loadAllKBs();
      // Don't load regions yet - wait for KB selection
      regionTree.value = [];
      showUserDialog.value = true;
    }

    async function onUserKbChange() {
      // Clear previously selected regions when KB changes
      userForm.value.regions = [];
      if (userForm.value.knowledge_base_ids && userForm.value.knowledge_base_ids.length > 0) {
        await loadRegionTree(userForm.value.knowledge_base_ids[0]);
      } else {
        regionTree.value = [];
      }
    }

    async function deleteUser(userId) {
      try {
        await ElMessageBox.confirm('确定删除此用户？此操作不可恢复', '提示', { type: 'warning' });
        await api(`/users/${userId}`, { method: 'DELETE' });
        ElMessage.success('删除成功');
        loadUsers();
      } catch (e) {
        if (e !== 'cancel') ElMessage.error(e.message);
      }
    }

    async function loadUsers() { loadingUsers.value = true; try { users.value = await api('/users'); } catch {} loadingUsers.value = false; }
    async function submitUser() {
      submittingUser.value = true;
      try {
        // 处理日期格式
        const [validFrom, validUntil] = userForm.value.validDateRange || [];
        const body = {
          real_name: userForm.value.real_name,
          phone: userForm.value.phone,
          regions: JSON.stringify(userForm.value.regions || []),
          valid_from: validFrom ? validFrom + 'T00:00:00' : null,
          valid_until: validUntil ? validUntil + 'T23:59:59' : null,
          knowledge_base_ids: userForm.value.knowledge_base_ids || []
        };

        if (editingUser.value) {
          if (userForm.value.password) body.password = userForm.value.password;
          await api(`/users/${editingUser.value.id}`, { method: 'PUT', body: JSON.stringify(body) });
        } else {
          body.username = userForm.value.username;
          body.password = userForm.value.password;
          body.role = userForm.value.role;
          await api('/users', { method: 'POST', body: JSON.stringify(body) });
        }
        showUserDialog.value = false;
        ElMessage.success(editingUser.value ? '更新成功' : '创建成功');
        loadUsers();
      } catch (e) { ElMessage.error(e.message); }
      submittingUser.value = false;
    }
    function editUser(row) {
      editingUser.value = row;
      let dr = null;
      if (row.valid_from && row.valid_until) {
        dr = [row.valid_from.slice(0, 10), row.valid_until.slice(0, 10)];
      }
      userForm.value = {
        ...row,
        password: '',
        phone: row.phone || '',
        validDateRange: dr,
        regions: row.regions ? (Array.isArray(row.regions) ? row.regions : (row.regions.trim() ? JSON.parse(row.regions) : [])) : [],
        knowledge_base_ids: row.knowledge_base_ids || []
      };
      showUserDialog.value = true;
    }
    async function toggleUser(row) {
      try { await api(`/users/${row.id}`, { method: 'PUT', body: JSON.stringify({ is_active: false }) }); ElMessage.success('已禁用'); loadUsers(); } catch (e) { ElMessage.error(e.message); }
    }

    async function changePassword() {
      if (!changePwdForm.value.old_password || !changePwdForm.value.new_password) { ElMessage.warning('请填写完整'); return; }
      if (changePwdForm.value.new_password !== changePwdForm.value.confirm_password) { ElMessage.error('两次密码不一致'); return; }
      if (changePwdForm.value.new_password.length < 6) { ElMessage.error('新密码至少6位'); return; }
      changingPwd.value = true;
      try {
        await api('/auth/change-password', { method: 'POST', body: JSON.stringify({ old_password: changePwdForm.value.old_password, new_password: changePwdForm.value.new_password }) });
        ElMessage.success('密码修改成功，请重新登录');
        showChangePwdDialog.value = false;
        changePwdForm.value = { old_password: '', new_password: '', confirm_password: '' };
        setTimeout(() => handleLogout(), 1000);
      } catch (e) { ElMessage.error(e.message); }
      changingPwd.value = false;
    }

    // Analytics
    const analytics = ref({});
    const consultStats = ref([]);
    const hotSymptoms = ref([]);
    const maxStatCount = computed(() => Math.max(...consultStats.value.map(s => s.count), 1));
    const maxSymptomCount = computed(() => Math.max(...hotSymptoms.value.map(s => s.count), 1));

    async function loadAnalytics() {
      try {
        analytics.value = await api('/analytics/overview');
        consultStats.value = await api('/analytics/consultation-stats');
        hotSymptoms.value = await api('/analytics/hot-symptoms');
      } catch {}
    }

    function formatDate(d) {
      if (!d) return '';
      let s = String(d).trim();
      // 确保带时区的 ISO 格式
      if (!s.endsWith('+08:00') && !s.endsWith('Z')) {
        s = s.replace(' ', 'T') + '+08:00';
      }
      const date = new Date(s);
      if (isNaN(date.getTime())) return d;
      return date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
    }

    // Watch page changes to load data
    watch(currentPage, (page) => {
      if (page === 'history') loadHistory();
      if (page === 'knowledge') loadKB();
      if (page === 'users') { loadUsers(); loadAllKBs(); loadRegionTree(); }
      if (page === 'analytics' || page === 'hot-symptoms') loadAnalytics();
    });

    onMounted(() => { if (isLoggedIn.value) loadMyKnowledgeBases(); });

    
// === Region Management ===
    const regionForm = ref({ name: '', parent_id: null, level: 'district', sort_order: 0 });
    const showRegionDialog = ref(false);
    const testDialog = ref(false);
    const editingRegionId = ref(null);
    
    const openAddRegionDialog = (parentId, level) => {
      editingRegionId.value = null;
      regionForm.value = { name: '', parent_id: parentId || null, level: level || 'district', sort_order: 0 };
      showRegionDialog.value = true;
    };
    
    const openEditRegionDialog = (node) => {
      editingRegionId.value = node.id;
      regionForm.value = { name: node.name, parent_id: node.parent_id, level: node.level, sort_order: node.sort_order };
      showRegionDialog.value = true;
    };
    
    const saveRegion = async () => {
      try {
        if (editingRegionId.value) {
          await api(`/regions/${editingRegionId.value}`, { method: 'PUT', body: JSON.stringify(regionForm.value) });
        } else {
          await api('/regions', { method: 'POST', body: JSON.stringify(regionForm.value) });
        }
        showRegionDialog.value = false;
        await loadRegionTree();
        ElMessage.success(editingRegionId.value ? '已更新' : '已创建');
      } catch (e) { ElMessage.error(e.message || '操作失败'); }
    };
    
    const deleteRegion = async (id) => {
      try {
        await ElMessageBox.confirm('确定删除该区域？子区域需要先删除。', '确认');
        await api(`/regions/${id}`, { method: 'DELETE' });
        await loadRegionTree();
        ElMessage.success('已删除');
      } catch (e) { if (e !== 'cancel') ElMessage.error(e.message || '删除失败'); }
    };

    return {
      apiBase, token, currentUser, isLoggedIn, loginForm, loginLoading, handleLogin, handleLogout,
      currentPage, sidebarOpen, roleLabels, canManageUsers, canViewAnalytics, creatableRoles, authHeaders,
      consultInput, consultKB, consultMessages, consultLoading, tongueImageBase64, tongueImagePreview,
      myKnowledgeBases, handleTongueImage, sendConsultation, saveToLocal, formatAIAnswer, openSaveCaseDialog,
      consultations, loadingHistory, showConsultDialog, selectedConsultation, viewConsultation, saveConsultation,
      localCases, caseSearch, loadLocalCases, showSaveCaseDialog, saveCaseForm, submitSaveCase,
      showLocalCaseDialog, selectedLocalCase, viewLocalCase, deleteLocalCase, followUpCase, addVisitToCase, followUpFromCaseId, viewTongueImage, showTongueViewer, tongueViewerSrc,
      knowledgeBases, loadingKB, showKBDialog, kbForm, kbDialogTitle, creatingKB, createKB, deleteKB, editKB, saveKB, savingKB,
      selectedKBDetail, openKBDetail, kbDocuments, docIcon, previewDoc,
      showDocPreview, previewingDoc, docPreviewContent, docPreviewLoading,
      onDocUploadSuccess, onDocError, beforeDocUpload, deleteDoc,
      showBindDialog, bindUserIds, allUsers, bindingKB, openBindDialog, bindKB,
      users, loadingUsers, showUserDialog, userForm, editingUser, submittingUser, 
      submitUser, editUser, toggleUser,
      openCreateUserDialog, onUserKbChange, deleteUser,
      showChangePwdDialog, changePwdForm, changingPwd, changePassword,
      analytics, consultStats, hotSymptoms, maxStatCount, maxSymptomCount,
      formatDate,
      allKBs, regionTree, loadRegionTree, regionForm, showRegionDialog, testDialog, editingRegionId,
    openAddRegionDialog, openEditRegionDialog, saveRegion, deleteRegion,
      // Mobile
      drawerOpen, pageTitle,
    };
  },
});

for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(key, component);
}
app.use(ElementPlus);

    // 挂载后检测状态
    onMounted(() => {
        console.log('[mount] isLoggedIn=', isLoggedIn.value, 'currentPage=', currentPage.value, 'token=', !!token.value);
        if (!!token.value && !isLoggedIn.value) {
            console.warn('[mount] token存在但isLoggedIn为false，强制刷新');
            token.value = localStorage.getItem('token') || '';
        }
    });


app.mount('#app'); window.__vueApp = app; window.showTestDlg = () => { window.__vueApp._instance.proxy.testDialog = true; };