<template>
    <div class="edit">
        <el-breadcrumb separator="/">
            <el-breadcrumb-item :to="{ path: '/market/' }">应用中心</el-breadcrumb-item>
            <el-breadcrumb-item>{{ isEdit ? '编辑' : '创建' }}应用身份</el-breadcrumb-item>
        </el-breadcrumb>
        <BreadcrumbHeader :pageName="isEdit ? '编辑应用身份' : '创建应用身份'" />
        <el-form label-position="top" label-width="auto" :model="detailInfo" :rules="rules" ref="ruleFormRef">
            <el-row class="content">
                <el-col :span="19" :xs="24">
                    <div class="left" ref="containerRef">
                        <div id="part1">
                            <div class="title">应用身份信息</div>
                            <el-divider />
                            <div class="form">
                                <el-form-item label="应用名称" prop="name">
                                    <el-input v-model="detailInfo.name" class="input-style" placeholder="请输入" />
                                </el-form-item>
                                <el-form-item label="身份密码" prop="password">
                                    <el-input v-model="detailInfo.password" type="password" class="input-style" placeholder="请输入" />
                                </el-form-item>
                                <el-form-item label="身份密码确认" prop="password2">
                                    <el-input v-model="detailInfo.password2" type="password" class="input-style" placeholder="请输入" />
                                </el-form-item>
                                <el-form-item label="应用描述" prop="description">
                                    <el-input
                                        v-model="detailInfo.description"
                                        class="input-style"
                                        placeholder="请输入"
                                        type="textarea"
                                    />
                                </el-form-item>
                                <el-form-item label="应用图标" prop="avatar">
                                    <el-radio-group v-model="avatarChk">
                                        <el-radio value="1">默认提供</el-radio>
                                        <el-radio value="2">上传图标</el-radio>
                                    </el-radio-group>
                                    <!-- <el-input v-model="detailInfo.name" class="input-style" placeholder="请输入"/> -->
                                </el-form-item>
                                <div v-if="avatarChk == '2'" class="wrap-cols">
                                    <Uploader @change="changeFileAvatar" v-model="avatarList" accept=".png,jpg">
                                        <el-button :icon="Upload">上传文件</el-button>
                                    </Uploader>
                                    <div class="upload-text">支持图片类型：png, jpg</div>
                                </div>
                                <div v-else>
                                    <img
                                        class="mr-1 w-7 h-7"
                                        :src="imageUrl"
                                        style="border-radius: 8px"
                                    />
                                </div>
                            </div>
                        </div>
                        <div id="part2">
                            <div class="title">应用信息</div>
                            <el-divider />
                            <div class="form">
                                <el-form-item label="应用代号" prop="code">
                                    <el-select v-model="detailInfo.code" placeholder="请选择" class="input-style">
                                        <el-option
                                            v-for="(key, value) in codeMap"
                                            :key="key + value"
                                            :label="key"
                                            :value="value"
                                        />
                                    </el-select>
                                </el-form-item>
                                <el-form-item label="绑定服务代号" prop="serviceCodes">
                                    <el-select
                                        v-model="detailInfo.serviceCodes"
                                        placeholder="选择应用code后默认展示"
                                        class="input-style"
                                        multiple
                                        :disabled="!detailInfo.code"
                                    >
                                        <el-option
                                            v-for="(key, value) in serviceCodeMap"
                                            :key="key + value"
                                            :label="key"
                                            :value="value"
                                        />
                                    </el-select>
                                </el-form-item>
                                <el-form-item label="代码包" prop="codePackagePath" style="margin-bottom: 0">
                                    <el-radio-group v-model="codeChk">
                                        <el-radio value="1" size="large">下载链接</el-radio>
                                        <el-radio value="2" size="large">上传文件</el-radio>
                                    </el-radio-group>
                                </el-form-item>

                                <div v-if="codeChk == '2'" class="wrap-cols">
                                    <Uploader @change="changeFileCode" v-model="codeList" accept=".zip,.rar,.tar.gz">
                                        <el-button :icon="Upload">上传文件</el-button>
                                    </Uploader>
                                    <div class="upload-text">支持文件类型：‌‌.zip ‌.rar .tar.gz 限制文件数量：1</div>
                                </div>
                                <div v-else class="wrap-cols" style="margin-bottom: 18px">
                                    <el-input
                                        v-model="detailInfo.codePackagePath"
                                        class="input-style"
                                        placeholder="请输入下载链接"
                                    />
                                </div>
                                <el-form-item label="访问地址(URL)" prop="location">
                                    <el-input
                                        v-model="detailInfo.location"
                                        class="input-style"
                                        placeholder="请输入应用访问地址"
                                    />
                                </el-form-item>
                                <el-form-item label="代码包Hash" prop="hash">
                                    <el-input
                                        v-model="detailInfo.hash"
                                        class="input-style"
                                        placeholder="系统默认计算"
                                        disabled
                                    />
                                </el-form-item>
                            </div>
                        </div>
                        <div class="footer">
                            <el-button type="default" @click="cancelForm">取消</el-button>
                            <el-button :type="isEdit ? 'default' : 'primary'" @click="submitForm(ruleFormRef)"
                                >保存
                            </el-button>
                            <el-button v-if="isEdit" type="primary" @click="submitFormAndOnline(ruleFormRef)"
                                >保存并上架
                            </el-button>
                        </div>
                    </div>
                </el-col>
                <el-col :span="4" class="right" :xs="0">
                    <el-anchor
                        :container="containerRef"
                        direction="vertical"
                        type="default"
                        :offset="30"
                        @click="handleClick"
                    >
                        <el-anchor-link href="#part1" title="基本信息" />
                        <el-anchor-link href="#part2" title="应用信息" />
                    </el-anchor>
                </el-col>
            </el-row>
        </el-form>
    </div>

    <ResultChooseModal
        v-model="innerVisible"
        title=""
        :closeIconHidden="true"
        mainDesc="应用创建成功"
        subDesc="可返回列表或继续上架当前应用"
        leftBtnText="上架应用"
        rightBtnText="返回列表"
        :leftBtnClick="toOnlineApply"
        :rightBtnClick="toList"
    >
        <template #icon>
            <el-icon :size="70"><SuccessFilled color="#30A46C" /></el-icon>
        </template>
    </ResultChooseModal>
</template>

<script lang="ts" setup>
import { ref, reactive, onMounted } from 'vue'
import $application, { ApplicationDetail, codeMap, codeMapTrans, serviceCodeMap, serviceCodeMapTrans } from '@/plugins/application'
import Uploader from '@/components/common/Uploader.vue'
import { Upload } from '@element-plus/icons-vue'
import { useRoute, useRouter } from 'vue-router'
import BreadcrumbHeader from '@/views/components/BreadcrumbHeader.vue'
import { ElMessageBox } from 'element-plus'
import { h } from 'vue'
import { SuccessFilled } from '@element-plus/icons-vue'
import ResultChooseModal from '@/views/components/ResultChooseModal.vue'
import { generateIdentity, userInfo } from '@/plugins/account'
import { v4 as uuidv4 } from 'uuid';
import { notifyError } from '@/utils/message'
import $storage from "@/plugins/storage";
import { getCurrentAccount } from '@/plugins/auth'

const defaultAvatar =
    import.meta.env.VITE_WEBDAV_AVATAR ||
    import.meta.env.VITE_STORAGE_AVATAR ||
    import.meta.env.VITE_MINIO_AVATAR ||
    'default.jpg'
const webdavBase = (import.meta.env.VITE_WEBDAV_BASE_URL || '').replace(/\/+$/, '')
const webdavPrefix = (import.meta.env.VITE_WEBDAV_PREFIX || '').replace(/\/+$/, '')
const webdavFallback = webdavBase
    ? `${webdavBase}${webdavPrefix ? `/${webdavPrefix.replace(/^\/+/, '')}` : ''}`
    : ''
const prefixURL = (
    import.meta.env.VITE_WEBDAV_PUBLIC_BASE ||
    import.meta.env.VITE_STORAGE_PUBLIC_BASE ||
    webdavFallback ||
    (typeof window !== 'undefined' ? window.location.origin : '')
).replace(/\/+$/, '')
const imageUrl = ref(`${prefixURL}/${defaultAvatar}`);


const route = useRoute()
const router = useRouter()

const goBack = () => {
    router.back()
}

const cancelForm = () => {
    ElMessageBox.confirm('', {
        message: h('p', null, [
            h('div', { style: 'font-size:18px;color:rgba(0,0,0,0.85)' }, '确定要取消创建应用吗？'),
            h('div', { style: 'font-size:14px;font-weight:400;color:rgba(0,0,0,0.85)' }, '取消后当前应用信息将不会保存')
        ]),
        type: 'warning',
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        showClose: false,
        customClass: 'messageBox-wrap'
    })
        .then(() => {
            goBack()
        })
        .catch(() => {})
}

const isEdit = ref(false)
const containerRef = ref(null)
const ruleFormRef = ref()
const avatarChk = ref('2')
const codeChk = ref('2')
const avatarList = ref([])

const codeList = ref([])
const detailInfo = ref<ApplicationDetail>({
    name: '',
    description: '',
    location: '',
    hash: '',
    code: '',
    serviceCodes: [],
    avatar: '',
    owner: '',
    ownerName: '',
    codePackagePath: '',
    password: '',
    password2: ''
})


const codeUrl = ref(detailInfo.value.codePackagePath)
const innerVisible = ref(false)
const handleClick = (e) => {
    e.preventDefault()
}
const rules = reactive({
    name: [{ required: true, message: '请输入', trigger: 'blur' }],
    password: [{ required: true, message: '请输入', trigger: 'blur' }],
    password2: [{ required: true, message: '请输入', trigger: 'blur' }],
    location: [{ required: true, message: '请输入', trigger: 'blur' }],
    avatar: [{ required: true, message: '请选择', trigger: 'blur' }],
    code: [{ required: true, message: '请选择', trigger: 'blur' }],
    serviceCodes: [{ required: true, message: '请选择', trigger: 'blur' }]
})

const getDetailInfo = async () => {
    console.log(`route.query.uid==${route.query.uid}`)
    if (route.query.uid) {
        isEdit.value = true
        const res = await $application.myCreateDetailByUid(route.query.uid as string)
        if (res) {
            detailInfo.value = res
            detailInfo.value.code = String(res.code)
            detailInfo.value.serviceCodes = res.serviceCodes.map((v) => String(v))
            avatarChk.value = res.avatar === '1' ? '1' : '2'
            avatarList.value =
                res.avatar !== '1'
                    ? [
                          {
                              name: res.avatarName,
                              url: res.avatar
                          }
                      ]
                    : []
            codeChk.value = res.codeType
            codeList.value =
                res.codeType === '2'
                    ? [
                          {
                              name: res.codePackageName,
                              url: res.codePackagePath
                          }
                      ]
                    : []
        }
    }
}

const submitForm = async (formEl, andOnline) => {
    const account = getCurrentAccount()
    if (account === undefined || account === null) {
        notifyError("❌未查询到当前账户，请登录")
        return
    }
    if (!formEl) return
    detailInfo.value.avatar = imageUrl.value
    if (codeUrl.value != '') {
        detailInfo.value.codePackagePath = codeUrl.value
    }
    
    await formEl.validate(async (valid: boolean, fields) => {
        if (valid) {
            const params = JSON.parse(JSON.stringify(detailInfo.value))
            const existsList = await $application.myCreateList(account)
            if (Array.isArray(existsList)) {
                for (const item of existsList) {
                    if (item.name === params.name) {
                        notifyError(`❌ 应用[${params.name}]已存在，请勿重复创建 `)
                        return
                    }
                }
            }
            params.codeType = codeChk.value
            if (route.query.uid) {
                console.log(`开始更新`)
                const rr = await $application.myCreateDetailByUid(route.query.uid as string)
                rr.code = params.code
                rr.codePackagePath = params.codePackagePath
                rr.codeType = params.codeType
                rr.description = params.description
                rr.location = params.location
                rr.name = params.name
                rr.owner = account
                rr.ownerName = account
                rr.serviceCodes = params.serviceCodes
                const myCreateUpdate = await $application.myCreateUpdate(rr)
                if (!andOnline) {
                    innerVisible.value = true
                } else {
                    /**
                     * 这块走的是保存并上架的逻辑，需要调用上架接口
                     */
                }
            } else {
                if (params.password !== params.password2) {
                    notifyError("❌2次密码输入不一致")
                    return
                }
                params.uid = uuidv4()
                const identity = await generateIdentity(params.code, params.serviceCodes, params.location, params.hash, params.name, params.description,params.avatar, params.password)
                params.did = identity.metadata?.did
                params.version = identity?.metadata?.version
                params.owner = account
                params.ownerName = account
                await $application.create(params)
                innerVisible.value = true
            }
        } else {
            console.log('error submit!', fields)
        }
    })
}

const toOnlineApply = async () => {
    innerVisible.value = false
    /**
     * todo 学虎  这里调用上架接口，
     * 点击保存按钮会弹出一个弹窗，左边按钮叫做上架应用
     * 目前调不通
     */
    const rst = await $application.online(did, version)
}
const toList = () => {
    router.push({
        path: '/market'
    })
}
const submitFormAndOnline = (formEl) => {
    submitForm(formEl, true)
}
const changeFileAvatar = (uploadFile) => {
    changeFile(1, uploadFile)
}
const changeFileCode = (uploadFile) => {
    changeFile(2, uploadFile)
}

const changeFile = async (fileType, uploadFile) => {
    // ✅ 关键：获取原始文件对象 raw
    const file = uploadFile.raw || uploadFile
    if (!(file instanceof Blob)) {
        notifyError('上传文件格式无效')
        return
    }
    const publicUrl = await $storage.uploadFile(file, uploadFile.name)
    if (!publicUrl) {
        notifyError('上传失败')
        return
    }
    if (fileType === 1) {
        imageUrl.value = publicUrl
    } else if (fileType === 2) {
        codeUrl.value = publicUrl
    }
}
onMounted(() => {
    getDetailInfo()
})
</script>
<style scoped lang="less">
.edit {
    margin: 20px;
    .el-divider--horizontal {
        margin: 16px 0 24px !important;
    }
    .content {
        margin-top: 24px;
        .left {
            height: 82vh;
            overflow-y: auto;
            padding-right: 20px;

            .input-style {
                width: 473px;
            }
            .upload-text {
                font-size: 14px;
                color: rgba(0, 0, 0, 0.85);
                font-weight: 400;
            }
            @media (max-width: 768px) {
                .input-style {
                    width: 240px;
                }
            }
            .title {
                font-size: 16px;
                font-weight: 500;
                color: rgba(0, 0, 0, 0.85);
                padding: 0 20px;
            }
            #part1,
            #part2 {
                background: #fff;
                padding: 20px 0;
                border-radius: 6px;
                margin-bottom: 18px;
                box-shadow:
                    0px 0px 1px 0px #00000014,
                    0px 1px 2px 0px #190f0f12,
                    0px 2px 4px 0px #0000000d;
                .form {
                    padding: 0 20px;
                }
            }
        }
        .right {
            margin-left: 20px;
            font-size: 14px;

            .el-anchor {
                --el-anchor-bg-color: transparent !important;
                .el-anchor__marker {
                    width: 2px !important;
                    height: 18px !important;
                }
            }

            .el-anchor__link.is-active {
                color: #1677ff !important;
            }
        }
    }
    .footer {
        margin-top: 20px;
        text-align: right;
        padding: 0 0px 20px 0;
    }
}
.status-desc {
    color: rgba(0, 0, 0, 0.45);
    font-size: 14px;
}
.waring-text {
    font-size: 18px;
    font-weight: 500;
    color: rgba(0, 0, 0, 0.85);
}
</style>
