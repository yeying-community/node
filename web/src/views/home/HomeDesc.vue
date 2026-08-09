<template>
  <div class="mx-auto pt-10 sm:pt-16 lg:pt-32">
    <div class="text-center">
      <div class="text-center flex justify-center">
        <div
            class="text-balance max-w-4xl font-display font-medium opacity-85 text-4xl tracking-tight text-gray-900 sm:text-6xl line_height sm:line_height2 leading-snug	">
          {{ $t('home_hero_title_prefix') }}
        </div>
      </div>
      <div class="mt-10 px-5 lg:px-0 text-lg font-body">{{ $t('home_hero_description') }}
      </div>
    </div>
    <!-- <Contact :isOpen="open" ref="RefContact"/> -->
  </div>
</template>
<style scoped>
.line_height2 {
  line-height: 1.4;
}

.line_height {
  line-height: 1.4;
}
</style>
