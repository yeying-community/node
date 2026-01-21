import { ref, computed } from 'vue'
import { defineStore } from 'pinia'

export const useProfileStore = defineStore('home', () => {
    const sidebarOpen = ref(false)
    const changeSlide = (isShow: any) => {
        sidebarOpen.value = isShow
    }

    return { changeSlide, sidebarOpen }
})
