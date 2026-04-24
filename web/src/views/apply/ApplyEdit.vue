<template>
    <div class="publish-page">
        <BreadcrumbHeader :pageName="isEdit ? '编辑应用' : '发布应用'" />

        <div class="publish-panel">
            <div class="panel-head">
                <div class="panel-title">发布 Web3 应用</div>
            </div>

            <el-form ref="formRef" label-position="top" :model="detailInfo" :rules="rules">
                <div class="section">
                    <div class="section-title">1. 选择应用模版</div>
                    <el-form-item>
                        <el-radio-group v-model="selectedPreset" @change="handlePresetChange">
                            <el-radio
                                v-for="preset in presets"
                                :key="preset.key"
                                :value="preset.key"
                            >
                                {{ preset.label }}
                            </el-radio>
                        </el-radio-group>
                    </el-form-item>
                    <div v-if="currentPreset" class="preset-tip">
                        {{ currentPreset.note }}
                    </div>
                </div>

                <div class="section">
                    <div class="section-title">2. 发布信息</div>
                    <el-row :gutter="20">
                        <el-col :span="12" :xs="24">
                            <el-form-item label="应用名称" prop="name">
                                <el-input
                                    v-model="detailInfo.name"
                                    placeholder="例如：Chat / Router / Warehouse"
                                />
                            </el-form-item>
                        </el-col>
                        <el-col :span="12" :xs="24">
                            <el-form-item label="应用分类" prop="code">
                                <el-select v-model="detailInfo.code" placeholder="请选择应用分类">
                                    <el-option
                                        v-for="(label, code) in codeMap"
                                        :key="String(code)"
                                        :label="label"
                                        :value="String(code)"
                                    />
                                </el-select>
                            </el-form-item>
                        </el-col>
                    </el-row>

                    <el-form-item label="应用描述" prop="description">
                        <el-input
                            v-model="detailInfo.description"
                            type="textarea"
                            :rows="3"
                            maxlength="200"
                            show-word-limit
                            placeholder="面向谁、解决什么问题、主要能力是什么"
                        />
                    </el-form-item>

                    <el-row :gutter="20">
                        <el-col :span="12" :xs="24">
                            <el-form-item label="访问地址（URL）" prop="location">
                                <el-input
                                    v-model="detailInfo.location"
                                    placeholder="例如：http://localhost:3020"
                                />
                            </el-form-item>
                        </el-col>
                        <el-col :span="12" :xs="24">
                            <el-form-item label="源码路径或仓库地址" prop="codePackagePath">
                                <el-input
                                    v-model="detailInfo.codePackagePath"
                                    placeholder="例如：../chat 或 https://github.com/xxx/xxx"
                                />
                            </el-form-item>
                        </el-col>
                    </el-row>

                    <el-form-item label="依赖应用（可选）">
                        <el-select
                            v-model="detailInfo.serviceCodes"
                            placeholder="可选：按实际依赖选择应用"
                            multiple
                        >
                            <el-option
                                v-for="option in dependencyOptions"
                                :key="option.value"
                                :label="option.label"
                                :value="option.value"
                            />
                        </el-select>
                    </el-form-item>

                    <el-form-item label="授权回调地址（redirectUri，可选）">
                        <el-input
                            v-model="redirectUriInput"
                            placeholder="例如：http://localhost:3020/central-ucan-callback.html"
                        />
                        <div class="field-hint">
                            使用中心化 UCAN 时，第三方应用需传入 <code>appId</code>，且
                            <code>redirectUri</code> 必须与这里配置完全一致。<code>audience/capability</code>
                            由服务端自动推导，无需手填。
                        </div>
                    </el-form-item>

                    <el-form-item label="应用图标（可选）">
                        <div class="icon-uploader">
                            <div class="icon-preview-wrap">
                                <img
                                    class="avatar-preview"
                                    :src="imageUrl"
                                    alt="应用图标预览"
                                    @error="handleAvatarPreviewError"
                                />
                            </div>
                            <div class="icon-actions">
                                <Uploader
                                    v-model="avatarList"
                                    :show-file-list="false"
                                    accept=".png,.jpg,.jpeg,.svg"
                                    @change="changeFileAvatar"
                                >
                                    <el-button :icon="Upload" plain>更换图标</el-button>
                                </Uploader>
                                <span class="upload-text">建议 1:1，支持 PNG/JPG/SVG</span>
                            </div>
                        </div>
                    </el-form-item>
                </div>

                <div class="actions">
                    <el-button @click="cancelForm">取消</el-button>
                    <el-button @click="submitForm(false)">
                        {{ isEdit ? '保存修改' : '仅保存' }}
                    </el-button>
                    <el-button type="primary" @click="submitForm(true)">
                        {{ isEdit ? '保存并提交上架' : '保存并提交上架' }}
                    </el-button>
                </div>
            </el-form>
        </div>
    </div>
</template>

<script lang="ts" setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import { Upload } from '@element-plus/icons-vue'
import BreadcrumbHeader from '@/views/components/BreadcrumbHeader.vue'
import Uploader from '@/components/common/Uploader.vue'
import defaultAppAvatar from '@/assets/img/default.jpg'
import $application, { type ApplicationMetadata, codeMap, filterLegacyDependencies } from '@/plugins/application'
import $audit from '@/plugins/audit'
import { generateIdentity } from '@/plugins/account'
import { getCurrentAccount } from '@/plugins/auth'
import { normalizeAddress } from '@/utils/actionSignature'
import { notifyError } from '@/utils/message'
import $storage from '@/plugins/storage'

type PresetKey = 'chat' | 'router' | 'warehouse' | 'custom'

type ApplicationPreset = {
    key: PresetKey
    label: string
    note: string
    defaults: {
        name: string
        description: string
        code: string
        location: string
        codePackagePath: string
    }
}

type DependencyOption = {
    label: string
    value: string
}

const presets: ApplicationPreset[] = [
    {
        key: 'chat',
        label: 'Chat',
        note: '应用默认地址 http://localhost:3020',
        defaults: {
            name: 'Chat',
            description: '多模态 AI 聊天应用',
            code: 'APPLICATION_CODE_CHAT',
            location: 'http://localhost:3020',
            codePackagePath: 'git@github.com:yeying-community/chat.git'
        }
    },
    {
        key: 'router',
        label: 'Router',
        note: '应用默认地址 http://localhost:3011',
        defaults: {
            name: 'Router',
            description: '统一模型网关与管理后台，提供标准 API 路由与鉴权能力。',
            code: 'APPLICATION_CODE_ROUTER',
            location: 'http://localhost:5181',
            codePackagePath: 'git@github.com:yeying-community/router.git'
        }
    },
    {
        key: 'warehouse',
        label: 'Warehouse',
        note: '应用默认地址 http://localhost:6065',
        defaults: {
            name: 'Warehouse',
            description: 'Web3 数据与文件仓储服务，提供存储能力与身份认证能力。',
            code: 'APPLICATION_CODE_WAREHOUSE',
            location: 'http://localhost:6065',
            codePackagePath: 'git@github.com:yeying-community/warehouse.git'
        }
    },
    {
        key: 'custom',
        label: '自定义',
        note: '完全自定义发布，按实际项目填写访问地址和源码路径。',
        defaults: {
            name: '',
            description: '',
            code: 'APPLICATION_CODE_UNKNOWN',
            location: '',
            codePackagePath: ''
        }
    }
]

const route = useRoute()
const router = useRouter()

const isEdit = ref(false)
const selectedPreset = ref<PresetKey>('chat')
const formRef = ref<FormInstance>()

const avatarList = ref<Array<Record<string, unknown>>>([])
const avatarValue = ref('')
const imageUrl = ref(defaultAppAvatar)
const dependencyOptions = ref<DependencyOption[]>([])
const redirectUriInput = ref('')

const detailInfo = ref<ApplicationMetadata>({
    name: '',
    description: '',
    location: '',
    code: 'APPLICATION_CODE_CHAT',
    serviceCodes: [],
    redirectUris: [],
    avatar: '',
    owner: '',
    ownerName: '',
    codePackagePath: ''
})

const currentPreset = computed(() =>
    presets.find((item) => item.key === selectedPreset.value) || null
)

const rules = reactive<FormRules>({
    name: [{ required: true, message: '请输入应用名称', trigger: 'blur' }],
    description: [{ required: true, message: '请输入应用描述', trigger: 'blur' }],
    location: [{ required: true, message: '请输入访问地址', trigger: 'blur' }],
    codePackagePath: [{ required: true, message: '请输入源码路径或仓库地址', trigger: 'blur' }],
    code: [{ required: true, message: '请选择应用分类', trigger: 'change' }]
})

function toServiceCodeArray(value: unknown): string[] {
    if (Array.isArray(value)) {
        return filterLegacyDependencies(
            value.map((item) => String(item).trim()).filter((item) => item.length > 0)
        )
    }
    if (value === undefined || value === null) {
        return []
    }
    return filterLegacyDependencies(
        String(value)
            .split(',')
            .map((item) => item.trim())
            .filter((item) => item.length > 0)
    )
}

function toRedirectUriArray(value: unknown): string[] {
    const normalize = (item: unknown) => String(item || '').trim()
    if (Array.isArray(value)) {
        return Array.from(
            new Set(value.map((item) => normalize(item)).filter((item) => item.length > 0))
        )
    }
    if (value === undefined || value === null) {
        return []
    }
    const raw = String(value).trim()
    if (!raw) {
        return []
    }
    if (raw.startsWith('[')) {
        try {
            const parsed = JSON.parse(raw)
            if (Array.isArray(parsed)) {
                return Array.from(
                    new Set(parsed.map((item) => normalize(item)).filter((item) => item.length > 0))
                )
            }
        } catch {
            // fallback to split mode
        }
    }
    return Array.from(
        new Set(
            raw
                .split(/[\n,]/)
                .map((item) => item.trim())
                .filter((item) => item.length > 0)
        )
    )
}

function toSingleRedirectUri(value: unknown): string {
    const values = toRedirectUriArray(value)
    if (values.length === 0) {
        return ''
    }
    if (values.length > 1) {
        throw new Error('仅支持配置一个 redirectUri')
    }
    return values[0]
}

function detectPreset(app: ApplicationMetadata): PresetKey {
    const source = String(app.codePackagePath || '').toLowerCase()
    const name = String(app.name || '').toLowerCase()
    if (source.includes('/chat') || source.includes('../chat') || name.includes('chat')) {
        return 'chat'
    }
    if (source.includes('/router') || source.includes('../router') || name.includes('router')) {
        return 'router'
    }
    if (source.includes('/warehouse') || source.includes('../warehouse') || name.includes('warehouse')) {
        return 'warehouse'
    }
    return 'custom'
}

function applyPreset(key: PresetKey) {
    const preset = presets.find((item) => item.key === key)
    if (!preset) {
        return
    }
    selectedPreset.value = key
    detailInfo.value = {
        ...detailInfo.value,
        name: preset.defaults.name,
        description: preset.defaults.description,
        code: preset.defaults.code,
        location: preset.defaults.location,
        codePackagePath: preset.defaults.codePackagePath
    }
}

function handlePresetChange(value: string | number | boolean) {
    const key = String(value) as PresetKey
    applyPreset(key)
}

function resolveSubmitError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error || '未知错误')
    if (message.includes('USER_ROLE_DENIED')) {
        return '当前账号暂无发布权限（USER_ROLE_DENIED）。请重新登录后重试，或联系管理员确认角色为 NORMAL/OWNER。'
    }
    if (message.includes('USER_BLOCKED')) {
        return '当前账号已被禁用或冻结，无法发布应用。'
    }
    return message
}

async function getDetailInfo() {
    const uid = String(route.query.uid || '').trim()
    if (!uid) {
        applyPreset('chat')
        return
    }
    isEdit.value = true
    const res = await $application.myCreateDetailByUid(uid)
    if (!res) {
        return
    }
    detailInfo.value = {
        ...detailInfo.value,
        ...res,
        code: String(res.code || 'APPLICATION_CODE_UNKNOWN'),
        serviceCodes: toServiceCodeArray(res.serviceCodes),
        redirectUris: toRedirectUriArray(res.redirectUris),
        codePackagePath: String(res.codePackagePath || '')
    }
    redirectUriInput.value = toSingleRedirectUri(res.redirectUris)
    selectedPreset.value = detectPreset(res)
    avatarValue.value = String(res.avatar || '').trim()
    imageUrl.value = avatarValue.value || defaultAppAvatar
    avatarList.value = res.avatar
        ? [{ name: String(res.avatarName || res.name || 'avatar'), url: String(res.avatar) }]
        : []
}

async function loadDependencyOptions() {
    const currentUid = String(route.query.uid || '').trim()
    const options = new Set<string>()
    try {
        const onlineApps = await $application.search(
            {
                status: 'BUSINESS_STATUS_ONLINE'
            },
            1,
            500
        )
        if (Array.isArray(onlineApps)) {
            for (const app of onlineApps) {
                const uid = String(app?.uid || '').trim()
                const name = String(app?.name || '').trim()
                if (!name) {
                    continue
                }
                if (currentUid && uid && uid === currentUid) {
                    continue
                }
                options.add(name)
            }
        }
    } catch {
        // ignore and keep fallback options from current values
    }
    for (const value of toServiceCodeArray(detailInfo.value.serviceCodes)) {
        options.add(value)
    }
    dependencyOptions.value = Array.from(options).map((value) => ({
        label: value,
        value
    }))
}

function buildSubmitParams(account: string): ApplicationMetadata & { codeType?: string } {
    const normalizedOwner = normalizeAddress(account)
    const redirectUri = toSingleRedirectUri(redirectUriInput.value)
    return {
        ...detailInfo.value,
        code: String(detailInfo.value.code || 'APPLICATION_CODE_UNKNOWN'),
        serviceCodes: toServiceCodeArray(detailInfo.value.serviceCodes),
        redirectUris: redirectUri ? [redirectUri] : [],
        avatar: avatarValue.value,
        codePackagePath: String(detailInfo.value.codePackagePath || ''),
        codeType: '1',
        owner: normalizedOwner,
        ownerName: normalizedOwner
    }
}

async function submitPublishRequest(application: ApplicationMetadata) {
    const created = await $audit.submitPublishRequest({
        auditType: 'application',
        resource: application as Record<string, unknown>
    })
    if (created?.meta?.uid) {
        ElMessage.success('已提交上架申请')
    }
}

function toList() {
    router.push({ path: '/market/dev/my-apps', query: { tab: 'myCreate' } })
}

function cancelForm() {
    ElMessageBox.confirm('取消后当前页面未保存的信息会丢失，确定要返回吗？', '取消发布', {
        type: 'warning',
        confirmButtonText: '确定',
        cancelButtonText: '继续编辑',
        showClose: false
    })
        .then(() => {
            toList()
        })
        .catch(() => {})
}

async function submitForm(andPublish: boolean) {
    const account = getCurrentAccount()
    if (!account) {
        notifyError('❌未查询到当前账户，请登录')
        return
    }
    if (!formRef.value) {
        return
    }
    try {
        await formRef.value.validate()
    } catch {
        return
    }

    try {
        const params = buildSubmitParams(account)
        const uid = String(route.query.uid || '').trim()

        if (!uid) {
            const existsList = await $application.myCreateList(account)
            if (Array.isArray(existsList)) {
                const duplicated = existsList.find((item) => item.name === params.name)
                if (duplicated) {
                    notifyError(`❌应用 [${params.name}] 已存在，请勿重复创建`)
                    return
                }
            }
        }

        if (uid) {
            const updated = await $application.myCreateUpdate({
                uid,
                code: params.code,
                codePackagePath: params.codePackagePath,
                description: params.description,
                location: params.location,
                name: params.name,
                owner: params.owner,
                ownerName: params.ownerName,
                serviceCodes: params.serviceCodes,
                redirectUris: params.redirectUris,
                avatar: params.avatar
            })
            if (!updated) {
                return
            }
            detailInfo.value = { ...detailInfo.value, ...updated }
            if (andPublish) {
                await submitPublishRequest(updated)
                toList()
                return
            }
            ElMessage.success('应用修改已保存')
            return
        }

        const identity = await generateIdentity(
            String(params.code || ''),
            params.serviceCodes || [],
            String(params.location || ''),
            '',
            String(params.name || ''),
            String(params.description || ''),
            String(params.avatar || '')
        )
        params.did = identity.metadata?.did
        params.version = identity.metadata?.version
        const created = await $application.create(params)
        if (!created) {
            return
        }
        if (andPublish) {
            await submitPublishRequest(created)
            toList()
            return
        }
        ElMessage.success('应用已保存，可在“我创建的”中继续管理')
        toList()
    } catch (error) {
        console.error('❌应用保存失败', error)
        notifyError(`❌${resolveSubmitError(error)}`)
    }
}

async function changeFileAvatar(uploadFile: Record<string, unknown>) {
    const blobCandidate = uploadFile.raw instanceof Blob ? uploadFile.raw : uploadFile
    if (!(blobCandidate instanceof Blob)) {
        notifyError('上传文件格式无效')
        return
    }
    const nameCandidate = String(uploadFile.name || 'upload.bin')
    const publicUrl = await $storage.uploadFile(blobCandidate, nameCandidate)
    if (!publicUrl) {
        notifyError('上传失败')
        return
    }
    avatarValue.value = publicUrl
    imageUrl.value = publicUrl
}

function handleAvatarPreviewError(event: Event) {
    const target = event.target as HTMLImageElement | null
    if (!target) {
        return
    }
    const fallbackUrl = new URL(defaultAppAvatar, window.location.origin).href
    if (target.src === fallbackUrl) {
        return
    }
    target.src = fallbackUrl
}

onMounted(() => {
    void (async () => {
        await getDetailInfo()
        await loadDependencyOptions()
    })()
})
</script>

<style scoped lang="less">
.publish-page {
    margin: 20px;
}

.publish-panel {
    margin-top: 16px;
    padding: 20px;
    background: #fff;
    border-radius: 10px;
    box-shadow:
        0 1px 2px rgba(0, 0, 0, 0.08),
        0 3px 10px rgba(0, 0, 0, 0.05);
}

.panel-head {
    margin-bottom: 20px;
}

.panel-title {
    font-size: 18px;
    font-weight: 500;
    color: rgba(0, 0, 0, 0.88);
}

.section {
    padding: 16px;
    margin-bottom: 18px;
    background: #fafcff;
    border: 1px solid #e9edf5;
    border-radius: 8px;
}

.section-title {
    margin-bottom: 12px;
    font-size: 15px;
    font-weight: 500;
    color: rgba(0, 0, 0, 0.85);
}

.preset-tip {
    font-size: 13px;
    line-height: 1.5;
    color: #4f6b95;
}

.field-hint {
    margin-top: 8px;
    font-size: 12px;
    color: rgba(0, 0, 0, 0.55);
}

.icon-uploader {
    display: flex;
    align-items: center;
    gap: 14px;
    width: fit-content;
    min-height: 84px;
    padding: 10px 12px;
    background: #fff;
    border: 1px dashed #d9e2ef;
    border-radius: 10px;
}

.icon-preview-wrap {
    flex-shrink: 0;
    width: 62px;
    height: 62px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #f5f8fe;
    border: 1px solid #e3e8f2;
    border-radius: 14px;
    overflow: hidden;
}

.icon-actions {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
}

.upload-text {
    font-size: 12px;
    line-height: 1.4;
    color: #64748b;
}

.avatar-preview {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
}

.actions {
    display: flex;
    justify-content: flex-end;
    gap: 12px;
    padding-top: 6px;
}

@media (max-width: 960px) {
    .icon-uploader {
        width: 100%;
        align-items: flex-start;
    }
}
</style>
