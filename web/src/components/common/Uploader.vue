<template>
    <el-upload
      ref="uploadRef"
      :file-list="modelValue"
      @update:file-list="$emit('update:modelValue', $event)"
      class="upload-demo"
      :multiple="multiple"
      :on-change="handleChange"
      :on-exceed="handleExceed"
      :limit="limit"
      :auto-upload="false"
      :show-file-list="showFileList"
      :accept="accept"
    >
      <slot/>
      <template #tip>
      </template>
    </el-upload>
  </template>
<script lang="ts" setup>
  import { ref } from 'vue'
  import type { UploadInstance, UploadProps, UploadRawFile } from 'element-plus'
  import { genFileId } from 'element-plus'
  
  const emit = defineEmits(['change','removeAllFile','update:modelValue']);
  defineProps({
    desc: String,
    action: String,
    multiple: {
      type: Boolean,
      default: false,
    },
    limit: {
      type: Number,
      default: 1,
    },
    showFileList: {
      type: Boolean,
      default: true,
    },
    accept: {
      type: String,
      default: "",
    },
    modelValue: {
        type: Array,
        default: () => []
    }
  })
  const uploadRef = ref<UploadInstance>()

  const handleChange = (uploadFile) => {
    emit("change",uploadFile)
  }

  const handleExceed: UploadProps['onExceed'] = (files) => {
    const file = files[0] as UploadRawFile | undefined
    if (!file || !uploadRef.value) {
      return
    }
    uploadRef.value.clearFiles()
    file.uid = genFileId()
    uploadRef.value.handleStart(file)
  }

  </script>
  
