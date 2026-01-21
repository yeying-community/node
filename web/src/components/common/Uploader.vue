<template>
    <el-upload
      :file-list="modelValue"
      @update:file-list="$emit('update:modelValue', $event)"
      class="upload-demo"
      :multiple="multiple"
      :on-change="handleChange"
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
  import { ref,watch } from 'vue'
  
  const emit = defineEmits(['change','removeAllFile','update:modelValue']);
  const props = defineProps({
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
  const handleChange = (uploadFile) => {
    emit("change",uploadFile)
  }
  const handleRemove = (file, fileList) => {
    internalFileList.value = fileList;
  };

  </script>
  