<template>
    <div v-if="audit" class="audit-panel" :class="{ embedded: props.embedded }">
        <div class="title">审批进度</div>

        <div class="summary-grid">
            <div class="summary-card">
                <div class="summary-label">当前状态</div>
                <el-tag :type="stateTagType" effect="light">{{ summary?.state || '待审批' }}</el-tag>
            </div>
            <div class="summary-card">
                <div class="summary-label">同意进度</div>
                <div class="summary-value">{{ approvalProgress }}</div>
            </div>
            <div class="summary-card">
                <div class="summary-label">驳回数量</div>
                <div class="summary-value">{{ summary?.rejectionCount ?? 0 }}</div>
            </div>
            <div class="summary-card">
                <div class="summary-label">申请时间</div>
                <div class="summary-value">{{ formatTime(audit.meta?.createdAt) }}</div>
            </div>
        </div>

        <div class="info-grid">
            <div class="info-item">
                <div class="info-label">申请单号</div>
                <div class="info-value mono">{{ audit.meta?.uid || '-' }}</div>
            </div>
            <div class="info-item">
                <div class="info-label">申请原因</div>
                <div class="info-value">{{ audit.meta?.reason || '-' }}</div>
            </div>
        </div>

        <div class="group">
            <div class="group-title">待处理审批人</div>
            <div v-if="summary?.pendingApprovers?.length" class="tag-list">
                <el-tag v-for="item in summary.pendingApprovers" :key="item" effect="plain" type="info">
                    {{ item }}
                </el-tag>
            </div>
            <div v-else class="empty-text">暂无待处理审批人</div>
        </div>

        <div class="group split-group">
            <div class="group-block">
                <div class="group-title">已同意</div>
                <div v-if="summary?.approvedBy?.length" class="tag-list">
                    <el-tag v-for="item in summary.approvedBy" :key="item" effect="plain" type="success">
                        {{ item }}
                    </el-tag>
                </div>
                <div v-else class="empty-text">暂无同意记录</div>
            </div>
            <div class="group-block">
                <div class="group-title">已驳回</div>
                <div v-if="summary?.rejectedBy?.length" class="tag-list">
                    <el-tag v-for="item in summary.rejectedBy" :key="item" effect="plain" type="danger">
                        {{ item }}
                    </el-tag>
                </div>
                <div v-else class="empty-text">暂无驳回记录</div>
            </div>
        </div>

        <div class="group">
            <div class="group-title">审批轨迹</div>
            <el-timeline v-if="sortedComments.length" class="timeline">
                <el-timeline-item
                    v-for="comment in sortedComments"
                    :key="comment.uid || `${comment.signature}-${comment.createdAt}`"
                    :timestamp="formatTime(comment.createdAt)"
                    :type="timelineType(comment.status)"
                    placement="top"
                >
                    <div class="timeline-head">
                        <el-tag :type="commentTagType(comment.status)" size="small" effect="plain">
                            {{ decisionText(comment.status) }}
                        </el-tag>
                        <span class="timeline-actor">{{ displayActor(comment.signature) }}</span>
                    </div>
                    <div class="timeline-text">{{ comment.text || '未填写审批意见' }}</div>
                </el-timeline-item>
            </el-timeline>
            <el-empty v-else description="暂无审批记录" :image-size="72" />
        </div>
    </div>
</template>

<script lang="ts" setup>
import { computed } from 'vue'
import dayjs from 'dayjs'
import type { AuditAuditDetail, AuditCommentMetadata } from '@/plugins/audit'

const props = defineProps<{
    audit?: AuditAuditDetail | null
    embedded?: boolean
}>()

const summary = computed(() => props.audit?.summary)

const approvalProgress = computed(() => {
    const value = summary.value
    if (!value) {
        return '-'
    }
    return `${value.approvalCount}/${Math.max(1, value.requiredApprovals)}`
})

const stateTagType = computed(() => {
    const state = summary.value?.state
    if (state === '审批通过') {
        return 'success'
    }
    if (state === '审批驳回') {
        return 'danger'
    }
    return 'primary'
})

const sortedComments = computed(() =>
    [...(props.audit?.commentMeta || [])].sort(
        (left, right) => toTimestamp(right.createdAt) - toTimestamp(left.createdAt)
    )
)

function toTimestamp(value?: string) {
    const timestamp = value ? Date.parse(value) : 0
    return Number.isFinite(timestamp) ? timestamp : 0
}

function formatTime(value?: string) {
    if (!value) {
        return '-'
    }
    const date = dayjs(value)
    return date.isValid() ? date.format('YYYY-MM-DD HH:mm:ss') : value
}

function displayActor(value?: string) {
    const text = String(value || '').trim()
    if (!text) {
        return '未知审批人'
    }
    return text.split('::')[0] || text
}

function decisionText(status?: AuditCommentMetadata['status']) {
    return status === 'COMMENT_STATUS_REJECT' ? '已驳回' : '已同意'
}

function commentTagType(status?: AuditCommentMetadata['status']) {
    return status === 'COMMENT_STATUS_REJECT' ? 'danger' : 'success'
}

function timelineType(status?: AuditCommentMetadata['status']) {
    return status === 'COMMENT_STATUS_REJECT' ? 'danger' : 'success'
}
</script>

<style scoped lang="less">
.audit-panel {
    background: #fff;
    padding: 20px;
    border-radius: 6px;
    margin-bottom: 18px;
    box-shadow:
        0px 0px 1px 0px #00000014,
        0px 1px 2px 0px #190f0f12,
        0px 2px 4px 0px #0000000d;
}

.audit-panel.embedded {
    margin-bottom: 0;
    padding: 0;
    background: transparent;
    box-shadow: none;
}

.title {
    font-size: 16px;
    font-weight: 500;
    color: rgba(0, 0, 0, 0.85);
}

.summary-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 12px;
    margin-top: 16px;
}

.summary-card {
    border-radius: 10px;
    padding: 14px;
    background: linear-gradient(180deg, #fafcff 0%, #f5f8ff 100%);
    border: 1px solid rgba(22, 119, 255, 0.08);
}

:deep(.summary-card .el-tag) {
    font-size: 12px;
    font-weight: 400;
}

.summary-label {
    font-size: 13px;
    color: rgba(0, 0, 0, 0.45);
    margin-bottom: 8px;
}

.summary-value {
    font-size: 16px;
    line-height: 1.45;
    font-weight: 400;
    color: rgba(0, 0, 0, 0.88);
    word-break: break-word;
}

.info-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 12px;
    margin-top: 16px;
}

.info-item {
    padding: 14px 16px;
    background: #fafafa;
    border-radius: 8px;
}

.info-label {
    font-size: 13px;
    color: rgba(0, 0, 0, 0.45);
}

.info-value {
    margin-top: 6px;
    font-size: 13px;
    line-height: 1.6;
    font-weight: 400;
    color: rgba(0, 0, 0, 0.88);
    word-break: break-word;
}

.mono {
    font-family: Monaco, Menlo, Consolas, monospace;
}

.group {
    margin-top: 20px;
}

.split-group {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 16px;
}

.group-title {
    font-size: 14px;
    font-weight: 500;
    color: rgba(0, 0, 0, 0.85);
    margin-bottom: 10px;
}

.tag-list {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
}

.empty-text {
    font-size: 13px;
    color: rgba(0, 0, 0, 0.45);
}

.timeline {
    margin-top: 8px;
}

.timeline-head {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
}

.timeline-actor {
    font-size: 13px;
    font-weight: 400;
    color: rgba(0, 0, 0, 0.65);
    word-break: break-all;
}

.timeline-text {
    margin-top: 8px;
    font-size: 13px;
    color: rgba(0, 0, 0, 0.85);
    line-height: 1.6;
    word-break: break-word;
}
</style>
