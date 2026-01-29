<template>
    <div class="edit">
        <el-breadcrumb separator="/">
            <el-breadcrumb-item :to="{ path: '/market/service' }">服务中心</el-breadcrumb-item>
            <el-breadcrumb-item>{{ isEdit ? '编辑' : '创建' }}服务身份</el-breadcrumb-item>
        </el-breadcrumb>
        <BreadcrumbHeader :pageName="isEdit ? '编辑服务身份' : '创建服务身份'" />
        <el-form label-position="top" label-width="auto" :model="detailInfo" :rules="rules" ref="ruleFormRef">
            <el-row class="content">
                <el-col :span="19" :xs="24">
                    <div class="left" ref="containerRef">
                        <div id="servicePart1">
                            <div class="title">基本信息</div>
                            <el-divider />
                            <div class="form">
                                <el-form-item label="服务名称" prop="name">
                                    <el-input v-model="detailInfo.name" class="input-style" placeholder="请输入" />
                                </el-form-item>
                                <el-form-item label="服务描述" prop="description">
                                    <el-input
                                        v-model="detailInfo.description"
                                        class="input-style"
                                        placeholder="请输入"
                                        type="textarea"
                                    />
                                </el-form-item>
                                <el-form-item label="服务图标" prop="avatar">
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
                                    <div class="upload-text">支持图片类型：png, jpg,gif,图标大小30*30</div>
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
                        <div id="servicePart2">
                            <div class="title">服务信息</div>
                            <el-divider />
                            <div class="form">
                                <el-form-item label="服务代码" prop="code">
                                    <el-select v-model="detailInfo.code" placeholder="请选择" class="input-style">
                                        <el-option
                                            v-for="(key, value) in codeMap"
                                            :key="key + value"
                                            :label="key"
                                            :value="value"
                                        />
                                    </el-select>
                                </el-form-item>
                                <el-form-item label="接口代码" prop="apiCodes">
                                    <el-select
                                        v-model="detailInfo.apiCodes"
                                        placeholder="请选择"
                                        class="input-style"
                                        multiple
                                    >
                                        <el-option
                                            v-for="(key, value) in serviceCodeMap"
                                            :key="key + value"
                                            :label="key"
                                            :value="value"
                                        />
                                    </el-select>
                                    <!-- <el-input v-model="detailInfo.serviceCodes" class="input-style" placeholder="请输入应用访问地址"/> -->
                                </el-form-item>

                                <el-form-item label="代理地址" prop="proxy">
                                    <el-input
                                        v-model="detailInfo.proxy"
                                        class="input-style"
                                        placeholder="请输入服务代理地址"
                                    />
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
                                <el-form-item label="服务地址" prop="grpc">
                                    <el-input
                                        v-model="detailInfo.grpc"
                                        class="input-style"
                                        placeholder="请输入输入服务IP：端口（如：192.168.1.1:8080）"
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
                        <el-anchor-link href="#servicePart1" title="基本信息" />
                        <el-anchor-link href="#servicePart2" title="服务信息" />
                    </el-anchor>
                </el-col>
            </el-row>
        </el-form>
    </div>

    <ResultChooseModal
        v-model="innerVisible"
        title=""
        :closeIconHidden="true"
        mainDesc="服务创建成功"
        subDesc="可返回列表或继续上架当前服务"
        leftBtnText="上架服务"
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
import Uploader from '@/components/common/Uploader.vue'
import { Upload } from '@element-plus/icons-vue'
import { useRoute, useRouter } from 'vue-router'
import BreadcrumbHeader from '@/views/components/BreadcrumbHeader.vue'
import { ElMessageBox } from 'element-plus'
import { h } from 'vue'
import { SuccessFilled } from '@element-plus/icons-vue'
import ResultChooseModal from '@/views/components/ResultChooseModal.vue'
import { generateIdentity } from '@/plugins/account'
import { v4 as uuidv4 } from 'uuid';
import { notifyError } from '@/utils/message'
import $service, {codeMap, serviceCodeMap, ServiceMetadata } from '@/plugins/service'
import { getCurrentUtcString } from '@/utils/common'
import $storage from "@/plugins/storage";
import { getCurrentAccount, signWithWallet } from '@/plugins/auth'

const defaultAvatar =
    import.meta.env.VITE_WEBDAV_AVATAR ||
    'default.jpg'
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
const imageUrl = ref(`${prefixURL}/${defaultAvatar}`);

const route = useRoute()
const router = useRouter()

const goBack = () => {
    router.back()
}
const toList = () => {
    router.push({
        path: '/market/service'
    })
}

const toOnlineApply = () => {
    ElMessageBox.confirm('', {
        message: h('p', null, [
            h('div', { style: 'font-size:18px;color:rgba(0,0,0,0.85)' }, '确定要上架当前服务吗？'),
            h('div', { style: 'font-size:14px;font-weight:400;color:rgba(0,0,0,0.85)' }, '上架当前服务信息将不可再编辑')
        ]),
        type: 'warning',
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        showClose: false,
        customClass: 'messageBox-wrap'
    })
        .then(() => {
            /**
             * todo 学虎 上架服务接口
             *
             */
        })
        .catch(() => {})
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
const detailInfo = ref<ServiceMetadata>({
    name: '',
    description: '',
    proxy: '',
    code: '',
    apiCodes: [],
    avatar: '',
    owner: '',
    ownerName: '',
    codePackagePath: '',
})

const codeUrl = ref(detailInfo.value.codePackagePath)

const innerVisible = ref(false)
const userMeta = ref({})
const handleClick = (e) => {
    e.preventDefault()
}
const rules = reactive({
    name: [{ required: true, message: '请输入', trigger: 'blur' }],
    proxy: [{ required: true, message: '请输入', trigger: 'blur' }],
    avatar: [{ required: true, message: '请选择', trigger: 'blur' }],
    code: [{ required: true, message: '请选择', trigger: 'blur' }],
    apiCodes: [{ required: true, message: '请选择', trigger: 'blur' }]
})
const getDetailInfo = async () => {
    if (route.query.uid) {
        isEdit.value = true
        const res = await $service.myCreateDetailByUid(route.query.uid as string)
        if (res) {
            detailInfo.value = res
            detailInfo.value.code = String(res.code)
            detailInfo.value.apiCodes = res.apiCodes.map((v) => String(v))
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
    if (detailInfo.value.codePackagePath === undefined) {
        detailInfo.value.codePackagePath = codeUrl.value
    }
    
    await formEl.validate(async (valid: boolean, fields) => {
        if (valid) {
            const params = JSON.parse(JSON.stringify(detailInfo.value))
            const existsList = await $service.myCreateList(account)
            if (Array.isArray(existsList)) {
                for (const item of existsList) {
                    if (item.name === params.name) {
                        notifyError(`❌ 服务[${params.name}]已存在，请勿重复创建 `)
                        return
                    }
                }
            }
            params.codeType = codeChk.value
            if (route.query.uid) {
                const rr = await $service.myCreateDetailByUid(route.query.uid as string)
                rr.code = params.code
                rr.codePackagePath = params.codePackagePath
                rr.codeType = params.codeType
                rr.description = params.description
                rr.proxy = params.proxy
                rr.name = params.name
                rr.apiCodes = params.apiCodes
                rr.owner = account
                rr.ownerName = account
                const myCreateUpdate = await $service.myCreateUpdate(rr)
                if (!andOnline) {
                    innerVisible.value = true
                } else {
                    /**
                     * todo学虎 编辑页面-上架接口
                     * 这块走的是保存并上架的逻辑，需要调用上架接口
                     */
                }
            } else {
                params.uid = uuidv4()
                let signature = ''
                try {
                    signature = await signWithWallet(
                        JSON.stringify({
                            action: 'create_service',
                            owner: account,
                            name: params.name,
                            timestamp: new Date().toISOString()
                        })
                    )
                } catch (error) {
                    notifyError(`❌签名失败: ${error}`)
                    return
                }
                params.signature = signature
                const identity = await generateIdentity(params.code, params.apiCodes, '', '', params.name, params.description, params.avatar)
                params.did = identity.metadata?.did
                params.version = identity?.metadata?.version
                params.owner = account
                params.ownerName = account
                params.createdAt = getCurrentUtcString()
                params.updatedAt = getCurrentUtcString()
                await $service.create(params)
                innerVisible.value = true
            }
        } else {
            notifyError(`❌参数格式不对，${fields}`)
        }
    })
}
/**
 * todo 学虎，保存并上架服务
 * 保存接口调用submitForm可以实现
 * 上架接口需要补充在这里
 *
 */
const submitFormAndOnline = (formEl) => {
    submitForm(formEl)
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
    // await getDetailInfo();
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
