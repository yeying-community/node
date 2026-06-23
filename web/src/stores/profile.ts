import { ref } from 'vue'
import { defineStore } from 'pinia'

export const useProfileStore = defineStore('profile', () => {
    const sidebarOpen = ref(false)
    const changeSlide = (isShow: any) => {
        sidebarOpen.value = isShow
    }

    return { changeSlide, sidebarOpen }
})
