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
                <!-- <div>
                <div class="mx-auto flex size-12 items-center justify-center rounded-full bg-green-100">
                  <CheckIcon class="size-6 text-green-600" aria-hidden="true" />
                </div>
                <div class="mt-3 text-center sm:mt-5">
                  <DialogTitle as="h3" class="text-base font-semibold text-gray-900">Payment successful</DialogTitle>
                  <div class="mt-2">
                    <p class="text-sm text-gray-500">Lorem ipsum dolor sit amet consectetur adipisicing elit. Consequatur amet labore.</p>
                  </div>
                </div>
              </div>
              <div class="mt-5 sm:mt-6">
                <button type="button" class="inline-flex w-full justify-center rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600" @click="open = false">Go back to dashboard</button>
              </div> -->
                <div class="w-80 sm:w-96 text-base opacity-85 font-medium h-10 leading-10 pl-4">{{$t("common.contactUs")}}</div>
                <hr class="my-1">
                <form
                    @submit.prevent="handleSubmit"
                    >
                    <div class="px-6 mt-6">
                        <label for="email" class="block text-sm font-normal text-gray-900"><span class="text-red-500 mr-1">*</span>{{$t('common.email')}}</label>
                        <div class="mt-2">
                            <input v-model="form.email"
                             type="email" required="" :placeholder="$t('common.pleaseInput')"
                             class="pl-1.5 block w-full rounded-md border-0 py-1.5 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus-visible:outline-0 focus-visible:outline-offset-0 sm:text-sm/6" />
                        </div>
                    </div>
                    <div class="px-6 mt-6 relative">
                        <label for="pro_type" class="block text-sm font-normal text-gray-900"><span class="text-red-500 mr-1">*</span>{{$t("portal.issueType")}}</label>
                        <select-menu 
                        @change="changeType"
                        :selectId="form.pro_type"
                        :selectList="pro_type_list"/>
                        <!-- <input type="text" class="absolute focus-visible:outline-0 focus-visible:outline-offset-0" style="left:10%;bottom:10%;z-index:-1" required v-model="form.pro_type"/> -->
                        <!-- <div class="mt-2">
                            <select v-model="form.pro_type" required=""
                                id="pro_type"  
                                :placeholder="$t['ph_select']"
                                class="block w-full rounded-md border-0 py-1.5 pl-1 text-gray-900 ring-1 ring-inset ring-gray-300 focus:ring-2 focus:ring-indigo-600 sm:text-sm/6"
                              >
                                <option v-for="(item,index) in pro_type_list" :key="item.id+index" :value="item.id">{{item.name}}</option>
                            </select>
                        </div> -->
                    </div>
                    <div class="px-6 mt-6">
                        <label for="desc" class="block text-sm font-normal"><span class="text-red-500 mr-1">*</span>{{$t("common.describe")}}</label>
                        <div class="mt-2">
                            <textarea rows="3" v-model="form.desc" 
                                required="" 
                                id="desc"
                                :placeholder="$t('common.pleaseInput')"
                                class="pl-1.5 block w-full rounded-md border-0 py-1.5 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus-visible:outline-0 focus-visible:outline-offset-0 sm:text-sm/6" />
                        </div>
                    </div>
                    <hr class="my-6"/>
                    <div class="text-right pr-4">
                        <button type="button" 
                            @click="closeModal"
                            class="rounded-md mr-2 bg-white px-3 py-1 text-sm shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50">{{$t("common.cancel")}}</button>
                        <button type="submit" class="rounded-md bg-blue-600 px-3 py-1 text-sm text-white shadow-sm hover:bg-blue-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">
                          {{$t("common.confirm")}}
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
import { Dialog, DialogPanel, DialogTitle, TransitionChild, TransitionRoot } from '@headlessui/vue'
import SelectMenu from '@/components/common/SelectMenu.vue'

const { proxy } = getCurrentInstance();
const {$t}=proxy
const props = defineProps( ["isOpen"]);
const emit = defineEmits(['close']);
const open = ref(false)
const selectedType = ref({ id: null, name: '' })
const form = reactive({
    email: "",
    pro_type: null,
    desc: ""
})
const pro_type_list = ref([
    { id: null, name: '请选择' },
    { id: "1", name: '问题1' },
    { id: "2", name: '问题2' },
    { id: "3", name: '问题3' },
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
    const info = {
        email: "",
        pro_type: null,
        desc: ""
    }
    form.value = info
}
const changeType = (select) => {
  form.pro_type = select.id
}
const handleSubmit = async () => {
  // const info = await $surpport?.handleContact?.(form)
}
const test = (input) => {
  input.target.setCustomValidity('it is required')
  // setCustomValidity('必须填写！');
}
onMounted(()=> {
    open.value = props.isOpen;
})
defineExpose({
  openModal
});
</script>