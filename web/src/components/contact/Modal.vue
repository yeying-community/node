<template>
  <TransitionRoot as="template" :show="open">
    <Dialog class="relative z-10" @close="closeModal">
      <TransitionChild as="template" enter="ease-out duration-300" enter-from="opacity-0" enter-to="opacity-100" leave="ease-in duration-200" leave-from="opacity-100" leave-to="opacity-0">
        <div class="fixed inset-0 bg-gray-500/75 transition-opacity" />
      </TransitionChild>

      <div class="fixed inset-0 z-10 w-screen overflow-y-auto">
        <div 
          style="min-height:70%"
          class="flex items-end justify-center text-center sm:items-center">
          <TransitionChild as="template" enter="ease-out duration-300" enter-from="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95" enter-to="opacity-100 translate-y-0 sm:scale-100" leave="ease-in duration-200" leave-from="opacity-100 translate-y-0 sm:scale-100" leave-to="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95">
            <DialogPanel class="relative transform overflow-hidden rounded-lg bg-white pb-4 text-left shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-sm ">
                <div class="w-80 sm:w-96 text-base opacity-85 font-medium h-10 leading-10 pl-4">{{$t("btn_contact")}}</div>
                <hr class="my-1">
                <form
                    @submit.prevent="handleSubmit"
                    >
                    <div class="px-6 mt-6">
                        <label for="email" class="block text-sm font-normal text-gray-900"><span class="text-red-500 mr-1">*</span>{{$t('f_c_email')}}</label>
                        <div class="mt-2">
                            <input v-model="form.email"
                             type="email" required="" :placeholder="$t('ph_input')"
                             class="pl-1.5 block w-full rounded-md border-0 py-1.5 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus-visible:outline-0 focus-visible:outline-offset-0 sm:text-sm/6" />
                        </div>
                    </div>
                    <div class="px-6 mt-6 relative">
                        <label for="pro_type" class="block text-sm font-normal text-gray-900"><span class="text-red-500 mr-1">*</span>{{$t("f_c_type")}}</label>
                        <select-menu 
                        @change="changeType"
                        :selectId="form.pro_type"
                        :selectList="pro_type_list"/>
                    </div>
                    <div class="px-6 mt-6">
                        <label for="desc" class="block text-sm font-normal"><span class="text-red-500 mr-1">*</span>{{$t("f_c_desc")}}</label>
                        <div class="mt-2">
                            <textarea rows="3" v-model="form.desc" 
                                required="" 
                                id="desc"
                                :placeholder="$t('ph_input')"
                                class="pl-1.5 block w-full rounded-md border-0 py-1.5 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus-visible:outline-0 focus-visible:outline-offset-0 sm:text-sm/6" />
                        </div>
                    </div>
                    <hr class="my-6"/>
                    <div class="text-right pr-4">
                        <button type="button" 
                            @click="closeModal"
                            class="rounded-md mr-2 bg-white px-3 py-1 text-sm shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50">{{$t("btn_cancel")}}</button>
                        <button type="submit" class="rounded-md bg-blue-600 px-3 py-1 text-sm text-white shadow-sm hover:bg-blue-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">
                          {{$t("btn_ok")}}
                        </button>
                    </div>
                </form>
            </DialogPanel>
          </TransitionChild>
        </div>
      </div>
    </Dialog>
  </TransitionRoot>
</template>

<script lang="ts" setup>
import { ref,reactive, onMounted,getCurrentInstance } from 'vue'
import { Dialog, DialogPanel, TransitionChild, TransitionRoot } from '@headlessui/vue'
import SelectMenu from '@/components/common/SelectMenu.vue'

const { proxy } = getCurrentInstance();
const {$t}=proxy
const props = defineProps( ["isOpen"]);
const emit = defineEmits(['close']);
const open = ref(false)
const form = reactive({
    email: "",
    pro_type: null,
    desc: ""
})
const pro_type_list = ref([
    { id: null, name: String($t('contact_issue_select')) },
    { id: "1", name: String($t('contact_issue_account')) },
    { id: "2", name: String($t('contact_issue_product')) },
    { id: "3", name: String($t('contact_issue_other')) },
])
const closeModal = () => {
    open.value = false
    emit("close")
}
const openModal = () => {
    open.value = true
    getDetail()
}
const getDetail = () => {
    form.email = ""
    form.pro_type = null
    form.desc = ""
}
const changeType = (select) => {
  form.pro_type = select.id
}
const handleSubmit = async () => {
  // const info = await $surpport?.handleContact?.(form)
}
onMounted(()=> {
    open.value = props.isOpen;
})
defineExpose({
  openModal
});
</script>
