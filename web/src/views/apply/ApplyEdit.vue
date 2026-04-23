<template>
    <div class="publish-page">
        <el-breadcrumb separator="/">
            <el-breadcrumb-item :to="{ path: '/market/' }">应用中心</el-breadcrumb-item>
            <el-breadcrumb-item>{{ isEdit ? '编辑应用' : '发布应用' }}</el-breadcrumb-item>
        </el-breadcrumb>

        <BreadcrumbHeader :pageName="isEdit ? '编辑应用' : '发布应用'" />

        <div class="publish-panel">
            <div class="panel-head">
                <div class="panel-title">发布 Web3 应用</div>
                <div class="panel-subtitle">
                    先支持快速发布，默认提供 Chat / Router / Warehouse 三个模板，源码路径按当前仓库父目录约定：
                    <code>../chat</code>、<code>../router</code>、<code>../warehouse</code>。
                </div>
            </div>

            <el-form ref="formRef" label-position="top" :model="detailInfo" :rules="rules">
                <div class="section">
                    <div class="section-title">1. 选择模板</div>
                    <el-form-item label="应用模板">
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

                    <el-form-item label="上传代码包（可选，上传后会覆盖源码路径）">
                        <div class="upload-row">
                            <Uploader
                                v-model="codeList"
                                accept=".zip,.rar,.tar.gz"
                                @change="changeFileCode"
                            >
                                <el-button :icon="Upload">上传压缩包</el-button>
                            </Uploader>
                            <span class="upload-text">支持 .zip / .rar / .tar.gz</span>
                        </div>
                    </el-form-item>

                    <el-form-item label="应用图标（可选）">
                        <div class="upload-row">
                            <img class="avatar-preview" :src="imageUrl" alt="avatar" />
                            <Uploader v-model="avatarList" accept=".png,.jpg,.jpeg,.svg" @change="changeFileAvatar">
                                <el-button :icon="Upload">上传图标</el-button>
                            </Uploader>
                            <span class="upload-text">默认使用系统图标，建议上传 1:1 图标</span>
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
import $application, { type ApplicationMetadata, codeMap } from '@/plugins/application'
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
        serviceCodes: string[]
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
        note: '模板默认指向父目录源码 ../chat，端口建议 http://localhost:3020',
        defaults: {
            name: 'Chat',
            description: '多模态 AI 聊天应用',
            code: 'APPLICATION_CODE_CHAT',
            serviceCodes: [],
            location: 'http://localhost:3020',
            codePackagePath: '../chat'
        }
    },
    {
        key: 'router',
        label: 'Router',
        note: '模板默认指向父目录源码 ../router，前端访问建议 http://localhost:5181',
        defaults: {
            name: 'Router',
            description: '统一模型网关与管理后台，提供标准 API 路由与鉴权能力。',
            code: 'APPLICATION_CODE_ROUTER',
            serviceCodes: [],
            location: 'http://localhost:5181',
            codePackagePath: '../router'
        }
    },
    {
        key: 'warehouse',
        label: 'Warehouse',
        note: '模板默认指向父目录源码 ../warehouse，服务地址建议 http://localhost:6065',
        defaults: {
            name: 'Warehouse',
            description: 'Web3 数据与文件仓储服务，提供存储能力与身份认证能力。',
            code: 'APPLICATION_CODE_WAREHOUSE',
            serviceCodes: [],
            location: 'http://localhost:6065',
            codePackagePath: '../warehouse'
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
            serviceCodes: [],
            location: '',
            codePackagePath: ''
        }
    }
]

const defaultAvatar = import.meta.env.VITE_WEBDAV_AVATAR || 'default.jpg'
const webdavBase = (import.meta.env.VITE_WEBDAV_BASE_URL || '').replace(/\/+$/, '')
const webdavPrefix = (import.meta.env.VITE_WEBDAV_PREFIX || '').replace(/\/+$/, '')
const webdavFallback = webdavBase
    ? `${webdavBase}${webdavPrefix ? `/${webdavPrefix.replace(/^\/+/, '')}` : ''}`
    : ''
const prefixURL = (
    import.meta.env.VITE_WEBDAV_PUBLIC_BASE ||
    webdavFallback ||
    (typeof window !== 'undefined' ? window.location.origin : '')
).replace(/\/+$/, '')

const route = useRoute()
const router = useRouter()

const isEdit = ref(false)
const selectedPreset = ref<PresetKey>('chat')
const formRef = ref<FormInstance>()

const avatarList = ref<Array<Record<string, unknown>>>([])
const codeList = ref<Array<Record<string, unknown>>>([])
const imageUrl = ref(`${prefixURL}/${defaultAvatar}`)
const dependencyOptions = ref<DependencyOption[]>([])

const detailInfo = ref<ApplicationMetadata>({
    name: '',
    description: '',
    location: '',
    code: 'APPLICATION_CODE_CHAT',
    serviceCodes: [],
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
        return value.map((item) => String(item)).filter((item) => item.trim().length > 0)
    }
    if (value === undefined || value === null) {
        return []
    }
    return String(value)
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
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
        serviceCodes: [...preset.defaults.serviceCodes],
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
        codePackagePath: String(res.codePackagePath || '')
    }
    selectedPreset.value = detectPreset(res)
    imageUrl.value = res.avatar || imageUrl.value
    avatarList.value = res.avatar
        ? [{ name: String(res.avatarName || res.name || 'avatar'), url: String(res.avatar) }]
        : []
    codeList.value = res.codePackagePath
        ? [{ name: String(res.codePackageName || res.name || 'package'), url: String(res.codePackagePath) }]
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
    return {
        ...detailInfo.value,
        code: String(detailInfo.value.code || 'APPLICATION_CODE_UNKNOWN'),
        serviceCodes: toServiceCodeArray(detailInfo.value.serviceCodes),
        avatar: imageUrl.value,
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
    router.push({ path: '/market' })
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

async function changeFile(fileType: 'avatar' | 'code', uploadFile: Record<string, unknown>) {
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
    if (fileType === 'avatar') {
        imageUrl.value = publicUrl
        return
    }
    detailInfo.value.codePackagePath = publicUrl
}

function changeFileAvatar(uploadFile: Record<string, unknown>) {
    void changeFile('avatar', uploadFile)
}

function changeFileCode(uploadFile: Record<string, unknown>) {
    void changeFile('code', uploadFile)
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

.panel-subtitle {
    margin-top: 8px;
    font-size: 14px;
    color: rgba(0, 0, 0, 0.55);
    line-height: 1.6;
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

.upload-row {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
}

.upload-text {
    font-size: 13px;
    color: rgba(0, 0, 0, 0.5);
}

.avatar-preview {
    width: 36px;
    height: 36px;
    border-radius: 8px;
    object-fit: cover;
    border: 1px solid #e5e7eb;
}

.actions {
    display: flex;
    justify-content: flex-end;
    gap: 12px;
    padding-top: 6px;
}
</style>
