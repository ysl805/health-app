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

    const roleLabels = {
      super_admin: '超级管理员', admin: '管理员',
      province_manager: '省级总经理', region_manager: '地区经理',
      business_manager: '业务经理', user: '普通用户'
    };

    const canManageUsers = computed(() => ['super_admin','admin','province_manager','region_manager','business_manager'].includes(currentUser.value?.role));
    const canViewAnalytics = computed(() => ['super_admin','admin'].includes(currentUser.value?.role));

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
    const canCreateUser = computed(() => currentUser.value?.role === 'super_admin');

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
        loadMyKnowledgeBases();
      } catch (e) { ElMessage.error(e.message); }
      loginLoading.value = false;
    }

    function handleLogout() {
      token.value = ''; currentUser.value = null;
      localStorage.removeItem('token'); localStorage.removeItem('currentUser');
      currentPage.value = 'consultation';
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
        const res = await api(`/consultations/${id}`);
        // Open save case dialog with consultation data
        saveCaseForm.value = {
          consultation_id: id,
          patient_name: '',
          patient_gender: '男',
          patient_age: '',
          patient_phone: '',
          patient_address: '',
          question: res.question || '',
          answer: res.reply || res.answer || '',
          tongue_analysis: res.tongue_analysis || '',
          syndrome_analysis: res.syndrome_analysis || '',
          symptoms: res.symptoms || [],
          tongue_image_base64: '',
        };
        showSaveCaseDialog.value = true;
      } catch (e) { ElMessage.error(e.message); }
    }

    // Local Cases
    const localCases = ref([]);
    const loadingLocalCases = ref(false);
    const caseSearch = ref('');
    const showSaveCaseDialog = ref(false);
    const savingCase = ref(false);
    const saveCaseForm = ref({ consultation_id: null, patient_name: '', patient_gender: '男', patient_age: '', patient_phone: '', patient_address: '', question: '', answer: '', tongue_analysis: '', syndrome_analysis: '', symptoms: [] });
    const showLocalCaseDialog = ref(false);
    const selectedLocalCase = ref(null);

    async function loadLocalCases() {
      loadingLocalCases.value = true;
      try {
        const params = caseSearch.value ? `?search=${encodeURIComponent(caseSearch.value)}` : '';
        localCases.value = await api(`/local-cases${params}`);
      } catch (e) { ElMessage.error(e.message); }
      loadingLocalCases.value = false;
    }

    async function openSaveCaseDialog(msg) {
      saveCaseForm.value = {
        consultation_id: msg.id,
        patient_name: '',
        patient_gender: '男',
        patient_age: '',
        patient_phone: '',
        patient_address: '',
        question: '',
        answer: msg.content,
        tongue_analysis: '',
        syndrome_analysis: '',
        symptoms: [],
        tongue_image_base64: msg.tonguePreview || '',
      };
      showSaveCaseDialog.value = true;
    }

    async function submitSaveCase() {
      if (!saveCaseForm.value.patient_name.trim()) {
        ElMessage.warning('请输入患者姓名'); return;
      }
      savingCase.value = true;
      try {
        await api('/local-cases', {
          method: 'POST',
          body: JSON.stringify(saveCaseForm.value),
        });
        ElMessage.success('案例已保存');
        showSaveCaseDialog.value = false;
        // Mark message as saved
        const msg = consultMessages.value.find(m => m.id === saveCaseForm.value.consultation_id);
        if (msg) msg.saved = true;
      } catch (e) { ElMessage.error(e.message); }
      savingCase.value = false;
    }

    async function viewLocalCase(row) {
      try {
        selectedLocalCase.value = await api(`/local-cases/${row.id}`);
        showLocalCaseDialog.value = true;
      } catch (e) { ElMessage.error(e.message); }
    }

    async function deleteLocalCase(row) {
      if (!confirm('确定要删除此案例吗？')) return;
      try {
        await api(`/local-cases/${row.id}`, { method: 'DELETE' });
        ElMessage.success('案例已删除');
        loadLocalCases();
      } catch (e) {
        ElMessage.error(e.message || '删除失败');
      }
    }

    // Knowledge Bases
    const knowledgeBases = ref([]);
    const allKBs = ref([]);
    const regionTree = ref([]);
    const levelLabels = ref({});
const levelOrder = ref([]);
const loadRegionTree = async () => {
      try {
        // 根据选中的知识库过滤区域
        const kbId = selectedRegionKb.value;
        const url = kbId ? `/regions/tree?kb_id=${kbId}` : "/regions/tree";
        console.log('[DEBUG] loadRegionTree: loading from', url);
        const r = await api(url);
        console.log('[DEBUG] loadRegionTree: r =', r);
        console.log('[DEBUG] loadRegionTree: r.data =', r.data);
        regionTree.value = (r.data || []);
        console.log('[DEBUG] loadRegionTree: regionTree.value =', regionTree.value);
        if (r.level_labels) levelLabels.value = r.level_labels;
        if (r.level_order) levelOrder.value = r.level_order;
      } catch(e) { console.error("Load regions failed", e); }
    };

    const onKBBindChange = () => {
      if (userForm.value.knowledge_base_ids && userForm.value.knowledge_base_ids.length > 0) {
        selectedRegionKb.value = userForm.value.knowledge_base_ids[0];
      } else {
        selectedRegionKb.value = null;
      }
      loadRegionTree();
    };

    const regionCascaderOptions = computed(() => {
      function toCascader(nodes) {
        return (nodes || []).map(n => {
          const lbl = levelLabels.value[n.level] || n.level;
          // Backend returns 'value' and 'label', not 'id' and 'name'
          const item = { value: n.value, label: n.label + " (" + lbl + ")" };
          if (n.children && n.children.length > 0) item.children = toCascader(n.children);
          return item;
        });
      }
      return toCascader(regionTree.value);
    });  // 所有知识库（用于用户绑定）
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
        const data = await api('/knowledge-bases');
        console.log('loadAllKBs raw response:', data, 'type:', typeof data, Array.isArray(data));
        allKBs.value = Array.isArray(data) ? data : [];
      } catch (e) {
        console.error('loadAllKBs error:', e);
        if (currentUser.value?.role === 'super_admin') ElMessage.error('加载知识库失败: ' + e.message);
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
    const userForm = ref({ username: '', password: '', role: '', real_name: '', regions: [], phone: '', validDateRange: null, org_name: '', region_id: null, knowledge_base_ids: [] });
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
      // KB binding will trigger region loading via onKBBindChange
      selectedRegionKb.value = null;
      await loadRegionTree();
      console.log('allKBs loaded:', allKBs.value.length, allKBs.value);
      showUserDialog.value = true;
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
        // 处理日期格式 (daterange 返回 [start, end] 数组)
        const vdr = userForm.value.validDateRange;
        const validFrom = vdr && vdr[0] ? vdr[0] + 'T00:00:00' : null;
        const validUntil = vdr && vdr[1] ? vdr[1] + 'T23:59:59' : null;
        
        const body = {
          real_name: userForm.value.real_name,
          province: userForm.value.province,
          region: userForm.value.region,
          phone: userForm.value.phone,
          org_name: userForm.value.org_name,
          region_id: userForm.value.region_id,
          valid_from: validFrom,
          valid_until: validUntil,
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
      userForm.value = { 
        ...row, 
        password: '',
        phone: row.phone || '',
        validDateRange: (row.valid_from && row.valid_until) ? [row.valid_from.slice(0, 10), row.valid_until.slice(0, 10)] : null,
        org_name: row.org_name || "",
        region_id: row.region_id || null,
        knowledge_base_ids: row.knowledge_base_ids || []
      };
      // Set KB and load regions - use user's bound KB
      if (row.knowledge_base_ids && row.knowledge_base_ids.length > 0) {
        selectedRegionKb.value = row.knowledge_base_ids[0];
      } else {
        selectedRegionKb.value = null;
      }
      loadRegionTree();
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
      if (page === 'users') { loadUsers(); loadAllKBs(); }
      if (page === 'analytics' || page === 'hot-symptoms') loadAnalytics();
      if (page === 'inventory') { loadSubordinates(); loadInventory(); }
    });

    onMounted(() => { if (isLoggedIn.value) loadMyKnowledgeBases(); });

    
// === Manager / Subordinate ===
    const managers = ref([]);  // 可选业务经理列表
    const subordinates = ref([]);  // 下属客户列表

    async function loadManagers() {
      try { managers.value = await api('/managers'); } catch (e) { console.error('loadManagers failed', e); }
    }
    async function loadSubordinates() {
      try { subordinates.value = await api('/subordinates'); } catch (e) { console.error('loadSubordinates failed', e); }
    }
    async function bindManager(userId, managerId) {
      try {
        await api('/bind-manager', { method: 'POST', body: JSON.stringify({ user_id: userId, manager_id: managerId || null }) });
        ElMessage.success('绑定成功');
        loadUsers();
      } catch (e) { ElMessage.error(e.message); }
    }

// === Inventory Management ===
    const inventoryItems = ref([]);
    const loadingInventory = ref(false);
    const showInvDialog = ref(false);
    const invForm = ref({ user_id: null, knowledge_base_id: null, product_name: '', specification: '', quantity: 0, unit: '', price: 0, cost_price: 0, notes: '' });
    const editingInv = ref(null);
    const invTargetUser = ref(null);
    const invAllKnowledgeBases = ref([]); // 所有可见知识库（用于关联产品来源）
    // AI 分析
    const aiAnalysisResult = ref(null);
    const aiAnalysisLoading = ref(false);
    const showAiAnalysis = ref(false);

    async function loadInventory(userId) {
      loadingInventory.value = true;
      try {
        const params = userId ? `?user_id=${userId}` : '';
        inventoryItems.value = await api(`/inventory${params}`);
        invTargetUser.value = userId || null;
      } catch (e) { ElMessage.error('加载库存失败: ' + e.message); }
      loadingInventory.value = false;
    }

    // 普通用户：只能给自己添加库存（user_id 固定为当前用户 id）
    // 业务经理：可选给自己或下属添加
    async function openAddInventory() {
      editingInv.value = null;
      const defaultUserId = currentUser.value.role === 'user' ? currentUser.value.id : (subordinates.value.length > 0 ? subordinates.value[0].id : currentUser.value.id);
      invForm.value = { user_id: defaultUserId, knowledge_base_id: null, product_name: '', specification: '', quantity: 0, unit: '盒', price: 0, cost_price: 0, notes: '' };
      // 加载知识库列表供选择
      try { invAllKnowledgeBases.value = await api('/knowledge-bases'); } catch (e) {}
      showInvDialog.value = true;
    }

    async function editInventory(item) {
      editingInv.value = item;
      invForm.value = {
        user_id: item.user_id,
        knowledge_base_id: item.knowledge_base_id || null,
        product_name: item.product_name,
        specification: item.specification || '',
        quantity: item.quantity,
        unit: item.unit || '',
        price: item.price,
        cost_price: item.cost_price || 0,
        notes: item.notes || '',
      };
      try { invAllKnowledgeBases.value = await api('/knowledge-bases'); } catch (e) {}
      showInvDialog.value = true;
    }

    async function submitInventory() {
      if (!invForm.value.product_name.trim()) { ElMessage.warning('请输入产品名称'); return; }
      if (!invForm.value.user_id) { ElMessage.warning('请选择客户'); return; }
      try {
        const payload = { ...invForm.value };
        // 普通用户强制 user_id 为自己
        if (currentUser.value.role === 'user') payload.user_id = currentUser.value.id;
        if (editingInv.value) {
          await api(`/inventory/${editingInv.value.id}`, { method: 'PUT', body: JSON.stringify(payload) });
          ElMessage.success('库存已更新');
        } else {
          await api('/inventory', { method: 'POST', body: JSON.stringify(payload) });
          ElMessage.success('库存已添加');
        }
        showInvDialog.value = false;
        loadInventory(invTargetUser.value);
      } catch (e) { ElMessage.error(e.message); }
    }

    async function deleteInventory(item) {
      try {
        await ElMessageBox.confirm(`确定删除「${item.product_name}」？`, '提示', { type: 'warning' });
        await api(`/inventory/${item.id}`, { method: 'DELETE' });
        ElMessage.success('已删除');
        loadInventory(invTargetUser.value);
      } catch (e) { if (e !== 'cancel') ElMessage.error(e.message); }
    }

    // AI 统计分析
    async function runAiAnalysis(userId) {
      aiAnalysisLoading.value = true;
      showAiAnalysis.value = true;
      aiAnalysisResult.value = null;
      try {
        const body = userId ? { user_id: userId } : {};
        aiAnalysisResult.value = await api('/inventory/ai-analysis', { method: 'POST', body: JSON.stringify(body) });
      } catch (e) { ElMessage.error('AI 分析失败: ' + e.message); }
      aiAnalysisLoading.value = false;
    }

    // 权限：普通用户和业务经理可读写库存，管理层只读
    const canModifyInventory = computed(() => ['user','business_manager'].includes(currentUser.value?.role));
    const canViewInventory = computed(() => ['super_admin','admin','province_manager','region_manager','business_manager','user'].includes(currentUser.value?.role));
    // 普通用户看不到下属选择器
    const isRegularUser = computed(() => currentUser.value?.role === 'user');

    // Watch: 加载库存和下属数据
    // (在现有的 watch(currentPage) 中添加)

// === Region Management ===
    const selectedRegionKb = ref(null);
    const regionForm = ref({ name: '', parent_id: null, level: 'district', sort_order: 0 });
    const showRegionDialog = ref(false);
    const testDialog = ref(false);
    const editingRegionId = ref(null);
    
    const openAddRegionDialog = (parentId, level) => { 
      nextTick(() => {
        
        
        
        
        
      });
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
        const payload = { ...regionForm.value };
        // 始终使用当前选中的知识库
        if (selectedRegionKb.value) {
          payload.knowledge_base_id = selectedRegionKb.value;
        }
        if (editingRegionId.value) {
          await api(`/regions/${editingRegionId.value}`, { method: 'PUT', body: JSON.stringify(payload) });
        } else {
          await api('/regions', { method: 'POST', body: JSON.stringify(payload) });
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

    
  // 移动端：切换页面时自动关闭侧边栏
  watch(currentPage, () => { sidebarOpen.value = false; })

return {
      apiBase, token, currentUser, isLoggedIn, loginForm, loginLoading, handleLogin, handleLogout,
      currentPage, sidebarOpen, roleLabels, canManageUsers, canCreateUser, canViewAnalytics, creatableRoles, authHeaders,
      consultInput, consultKB, consultMessages, consultLoading, tongueImageBase64, tongueImagePreview,
      myKnowledgeBases, handleTongueImage, sendConsultation, saveToLocal, formatAIAnswer, openSaveCaseDialog,
      consultations, loadingHistory, showConsultDialog, selectedConsultation, viewConsultation, saveConsultation,
      localCases, loadingLocalCases, caseSearch, loadLocalCases, showSaveCaseDialog, savingCase, saveCaseForm, submitSaveCase,
      showLocalCaseDialog, selectedLocalCase, viewLocalCase,
      knowledgeBases, loadingKB, showKBDialog, kbForm, kbDialogTitle, creatingKB, createKB, deleteKB, editKB, saveKB, savingKB,
      selectedKBDetail, openKBDetail, kbDocuments, docIcon, previewDoc,
      showDocPreview, previewingDoc, docPreviewContent, docPreviewLoading,
      onDocUploadSuccess, onDocError, beforeDocUpload, deleteDoc,
      showBindDialog, bindUserIds, allUsers, bindingKB, openBindDialog, bindKB,
      users, loadingUsers, showUserDialog, userForm, editingUser, submittingUser, 
      submitUser, editUser, toggleUser,
      openCreateUserDialog, deleteUser,  // 新增这两个函数
      showChangePwdDialog, changePwdForm, changingPwd, changePassword,
      analytics, consultStats, hotSymptoms, maxStatCount, maxSymptomCount,
      formatDate,
      allKBs, loadAllKBs, regionTree, loadRegionTree, selectedRegionKb, levelLabels, regionCascaderOptions, regionForm, showRegionDialog, testDialog, editingRegionId,
    openAddRegionDialog, openEditRegionDialog, saveRegion, deleteRegion,
    // Manager & Subordinate
    managers, subordinates, loadManagers, loadSubordinates, bindManager,
    // Inventory
    inventoryItems, loadingInventory, showInvDialog, invForm, editingInv, invTargetUser,
    invAllKnowledgeBases, loadInventory, openAddInventory, editInventory, submitInventory, deleteInventory,
    canViewInventory, canModifyInventory, isRegularUser,
    aiAnalysisResult, aiAnalysisLoading, showAiAnalysis, runAiAnalysis,
    };
  },
});

for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(key, component);
}
app.use(ElementPlus, { locale: window.__EP_ZH_CN });
app.mount('#app'); window.__vueApp = app; window.showTestDlg = () => { window.__vueApp._instance.proxy.testDialog = true; };